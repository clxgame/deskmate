use super::{
    collector::{collect_once_with, CollectorActions, SnapshotRead},
    opencode::{AgentEndpoint, OpenCodeClient},
    record_store::{NativeMessage, NativePart},
    test_support::{Checked, TestResult},
    AgentPermissionState, AgentRunState, RunOutcome, RunRecord, RunStore,
};
use crate::tool_permissions::runtime::{pending_scoped, respond_scoped, PermissionRequest, Reply};
use std::{
    cell::RefCell,
    collections::HashSet,
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

struct LiveHarness {
    base: String,
    workspace: PathBuf,
    archive: PathBuf,
    runs: AgentRunState,
    permissions: AgentPermissionState,
    client: OpenCodeClient,
    history: RefCell<Vec<crate::history::HistorySession>>,
}

impl LiveHarness {
    fn from_env() -> TestResult<Self> {
        let base = std::env::var("YUME_AGENT_TEST_BASE").checked("live runtime base")?;
        let workspace =
            PathBuf::from(std::env::var("YUME_AGENT_TEST_WORKSPACE").checked("live workspace")?)
                .canonicalize()?;
        let archive = workspace.join(format!("rust-host-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&archive)?;
        let client = OpenCodeClient::new(AgentEndpoint {
            base_url: base.clone(),
            provider_id: "yume".into(),
            model_id: "model-a".into(),
            workspace: workspace.clone(),
            auth_header: String::new(),
        });
        Ok(Self {
            base,
            workspace,
            runs: AgentRunState::new(RunStore::new(archive.join("runs"))),
            permissions: AgentPermissionState::default(),
            archive,
            client,
            history: RefCell::new(Vec::new()),
        })
    }

    fn start(&self, session: &str, marker: &str) -> TestResult<String> {
        let id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        self.runs.begin(&id, &self.workspace, marker)?;
        self.runs.bind_session_with(&id, session, || {
            self.permissions.register_run(&id, session, &self.workspace)
        })?;
        self.client.prompt(
            session,
            &id,
            "Run the requested tool lifecycle scenario.",
            marker,
        )?;
        self.runs.confirm_submission(&id)?;
        Ok(id)
    }

    fn tick(&self) -> TestResult<()> {
        self.tick_with_archive_failure(false)
    }

    fn tick_with_archive_failure(&self, fail_archive: bool) -> TestResult<()> {
        collect_once_with(
            &self.runs,
            &self.permissions,
            CollectorActions {
                snapshot: |record: &RunRecord| {
                    super::supervision::snapshot(&self.client, &self.runs, record)
                        .map(SnapshotRead::Messages)
                },
                pending: |record: &RunRecord| {
                    Ok(pending_scoped(&self.base, &self.workspace)?
                        .into_iter()
                        .filter(|request| Some(&request.session_id) == record.session_id.as_ref())
                        .collect())
                },
                archive: |record: &RunRecord, messages: &[NativeMessage]| {
                    if fail_archive {
                        let blocked = self.archive.join("blocked-history");
                        if !blocked.exists() {
                            fs::write(&blocked, b"synthetic path obstruction")
                                .map_err(|error| error.to_string())?;
                        }
                        return fs::write(blocked.join("history.json"), b"projection")
                            .map_err(|_| "history_storage_failed".to_owned());
                    }
                    fs::write(
                        self.archive.join(format!("{}.snapshot.txt", record.run_id)),
                        format!("{messages:#?}"),
                    )
                    .map_err(|error| error.to_string())?;
                    let session_id = record
                        .session_id
                        .as_deref()
                        .ok_or("agent_session_unknown")?;
                    let mut history = self.history.borrow_mut();
                    if !history.iter().any(|session| session.id == session_id) {
                        history.push(crate::history::HistorySession {
                            local_link: None,
                            id: session_id.into(),
                            title: record.run_id.clone(),
                            created: 0,
                            updated: 0,
                            messages: Vec::new(),
                            origin_run_id: Some(record.run_id.clone()),
                            deleted: false,
                        });
                    }
                    crate::history::archive_snapshot_for_test(
                        &self.archive.join("history.json"),
                        &mut history,
                        crate::history::AgentHistorySnapshot {
                            session_id,
                            messages,
                        },
                    )
                },
                respond: |_: &RunRecord, request: &PermissionRequest, reply: Reply| {
                    respond_scoped(&self.base, request, reply, &self.workspace)
                },
            },
        )?;
        Ok(())
    }

    fn finish(&self, run: &str, reply: Reply, expire: bool) -> TestResult<usize> {
        let deadline = Instant::now() + Duration::from_secs(45);
        let mut answered = 0;
        while Instant::now() < deadline {
            self.tick()?;
            if self.runs.read()?.active.is_none() {
                return Ok(answered);
            }
            let waiting = self.permissions.waiting(run)?;
            if expire && !waiting.is_empty() {
                self.permissions.expire_current_for_test(run)?;
                answered += waiting.len();
            } else {
                for waiting in waiting {
                    let request = self.permissions.take_reply(run, &waiting.request.id)?;
                    match respond_scoped(&self.base, &request, reply, &self.workspace) {
                        Ok(()) => answered += 1,
                        Err(error) if error == "permission_expired" => {}
                        Err(error) => return Err(error.into()),
                    }
                }
            }
            std::thread::yield_now();
        }
        Err(format!("host run did not finish: {run}").into())
    }

    fn assert_terminal(
        &self,
        session: &str,
        run: &str,
        count: usize,
        outcome: RunOutcome,
    ) -> TestResult<Vec<NativePart>> {
        let messages = self.client.snapshot(session)?;
        let parts = messages
            .iter()
            .filter(|message| message.parent_id.as_deref() == Some(run))
            .flat_map(|message| &message.parts)
            .filter(|part| part.kind.as_deref() == Some("tool"))
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(parts.len(), count, "tool count for {run}");
        let ids = parts
            .iter()
            .filter_map(|part| part.call_id.as_deref())
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), count, "one result per accepted call");
        assert!(parts.iter().all(|part| part
            .state
            .as_ref()
            .is_some_and(|state| matches!(state.status.as_str(), "completed" | "error"))));
        assert!(self.runs.read()?.active.is_none(), "host busy cleared");
        assert!(
            self.permissions.waiting(run).is_err(),
            "pending ownership cleared"
        );
        let persisted = self
            .runs
            .store
            .load()?
            .into_iter()
            .find(|record| record.run_id == run)
            .checked("persisted run")?;
        assert_eq!(persisted.outcome, Some(outcome));
        assert_eq!(persisted.call_ids.len(), count);
        assert!(self.archive.join(format!("{run}.snapshot.txt")).is_file());
        let history: Vec<crate::history::HistorySession> =
            serde_json::from_slice(&fs::read(self.archive.join("history.json"))?)
                .checked("persisted history JSON")?;
        let archived = history
            .iter()
            .find(|saved| saved.id == session)
            .checked("archived session")?;
        let keys = archived
            .messages
            .iter()
            .map(|message| (&message.message_id, &message.part_id))
            .collect::<HashSet<_>>();
        assert_eq!(
            keys.len(),
            archived.messages.len(),
            "archive must not duplicate message/part IDs"
        );
        for message in messages
            .iter()
            .filter(|message| message.parent_id.as_deref() == Some(run))
        {
            for part in message
                .parts
                .iter()
                .filter(|part| part.kind.as_deref() == Some("text"))
            {
                assert!(
                    archived
                        .messages
                        .iter()
                        .any(|saved| saved.message_id.as_deref() == Some(&message.id)
                            && saved.part_id.as_deref() == Some(&part.id)
                            && Some(saved.text.as_str()) == part.text.as_deref()),
                    "native assistant reply must be durably archived"
                );
            }
        }
        Ok(parts)
    }
}

#[test]
#[ignore = "requires scripts/agent-qa/tool-lifecycle.ts localhost runtime/provider"]
fn live_tool_lifecycle() -> TestResult<()> {
    // Given: a real sidecar, real PowerShell execution, and on-disk host run storage.
    let harness = LiveHarness::from_env()?;
    let orphan_session =
        std::env::var("YUME_AGENT_TEST_ORPHAN_SESSION").checked("restart orphan session")?;
    let orphan_run = std::env::var("YUME_AGENT_TEST_ORPHAN_RUN").checked("restart orphan run")?;
    harness
        .runs
        .begin(&orphan_run, &harness.workspace, "orphan")?;
    harness
        .runs
        .bind_session_with(&orphan_run, &orphan_session, || {
            harness
                .permissions
                .register_run(&orphan_run, &orphan_session, &harness.workspace)
        })?;
    harness.runs.confirm_submission(&orphan_run)?;
    harness.finish(&orphan_run, Reply::Once, false)?;
    harness.assert_terminal(&orphan_session, &orphan_run, 1, RunOutcome::Interrupted)?;
    println!("RUST_HOST_PASS restart orphan supervised and settled");
    let session = harness.client.create_session(&harness.workspace)?;

    // When: successful, multi-round, failed, timed-out, denied and expired calls run.
    for (marker, count, reply, expire) in [
        ("single", 1, Reply::Once, false),
        ("multi", 3, Reply::Once, false),
        ("failure", 1, Reply::Once, false),
        ("timeout", 1, Reply::Once, false),
        ("deny", 1, Reply::Reject, false),
        ("single", 1, Reply::Once, true),
        ("single", 1, Reply::Once, false),
    ] {
        let run = harness.start(&session, marker)?;
        assert!(
            harness.finish(&run, reply, expire)? > 0,
            "approval was actionable"
        );
        let parts = harness.assert_terminal(&session, &run, count, RunOutcome::Completed)?;
        if expire || matches!(reply, Reply::Reject) {
            assert!(parts.iter().all(|part| part
                .state
                .as_ref()
                .is_some_and(|state| state.status == "error")));
        }
        if expire {
            assert!(parts
                .iter()
                .all(|part| part.state.as_ref().is_some_and(|state| state
                    .output
                    .as_str()
                    .is_some_and(|output| output.contains("agent_approval_timeout")))));
        }
        if marker == "timeout" {
            std::thread::sleep(Duration::from_millis(3_200));
            assert!(
                !harness.workspace.join("timeout-late.txt").exists(),
                "native execution timeout allowed a late write"
            );
        }
        let messages = harness.client.snapshot(&session)?;
        assert!(messages
            .iter()
            .filter(|message| message.parent_id.as_deref() == Some(&run))
            .flat_map(|message| &message.parts)
            .any(|part| part
                .text
                .as_deref()
                .is_some_and(|text| text.contains(&format!("LIFECYCLE_COMPLETE:{marker}")))));
        println!("RUST_HOST_PASS marker={marker} expiry={expire} calls={count}");
    }

    // Then: cancellation settles every tool, clears host ownership, and permits the next task.
    for name in ["probe.pid", "late.txt"] {
        let path = harness.workspace.join(name);
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    let run = harness.start(&session, "cancel")?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        harness.tick()?;
        for waiting in harness.permissions.waiting(&run)? {
            let request = harness.permissions.take_reply(&run, &waiting.request.id)?;
            respond_scoped(&harness.base, &request, Reply::Once, &harness.workspace)?;
        }
        if harness.workspace.join("probe.pid").exists() {
            break;
        }
        if Instant::now() >= deadline {
            return Err("cancel command did not start".to_owned().into());
        }
        std::thread::yield_now();
    }
    let cancel_started = Instant::now();
    harness
        .client
        .settle_tools(&session, &run, "agent_cancelled")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let probe_pid = fs::read_to_string(harness.workspace.join("probe.pid"))?
            .trim()
            .parse::<u32>()
            .checked("cancelled PowerShell PID")?;
        let probe = std::process::Command::new("tasklist.exe")
            .args(["/FI", &format!("PID eq {probe_pid}"), "/FO", "CSV", "/NH"])
            .creation_flags(0x08000000)
            .output()
            .checked("query cancelled process")?;
        assert!(probe.status.success());
        assert!(
            !String::from_utf8_lossy(&probe.stdout).contains(&format!("\"{probe_pid}\"")),
            "cancelled PowerShell must have exited before settlement returns"
        );
    }
    harness
        .runs
        .request_finish(&run, RunOutcome::Cancelled, Some("agent_cancelled".into()))?;
    harness.tick()?;
    harness.assert_terminal(&session, &run, 1, RunOutcome::Cancelled)?;
    assert!(!harness.client.is_busy(&session)?);
    let next = harness.start(&session, "single")?;
    harness.finish(&next, Reply::Once, false)?;
    harness.assert_terminal(&session, &next, 1, RunOutcome::Completed)?;
    let observation_end = cancel_started + Duration::from_millis(3_500);
    while Instant::now() < observation_end {
        assert!(
            !harness.workspace.join("late.txt").exists(),
            "cancelled PowerShell wrote after cancellation"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!harness.workspace.join("late.txt").exists());
    assert!(
        !harness.workspace.join("timeout-late.txt").exists(),
        "timed out PowerShell wrote a late result"
    );
    println!(
        "RUST_HOST_PASS cancellation and immediate same-session reuse; evidence={}",
        harness.archive.display()
    );
    Ok(())
}

#[test]
#[ignore = "requires scripts/audit-remediation/verify-native.ts isolated native runtime/provider"]
fn live_audit_remediation() -> TestResult<()> {
    let mut harness = LiveHarness::from_env()?;
    // Native acceptance followed by failed host confirmation, then host state reload.
    let session = harness.client.create_session(&harness.workspace)?;
    let run = format!("msg_{}", uuid::Uuid::new_v4().simple());
    harness.runs.begin(&run, &harness.workspace, "QA_SHELL QA_RECOVERY")?;
    harness.runs.bind_session_with(&run, &session, || {
        harness
            .permissions
            .register_run(&run, &session, &harness.workspace)
    })?;
    harness
        .client
        .prompt(&session, &run, "Synthetic acceptance", "QA_SHELL QA_RECOVERY")?;
    let store = harness.runs.store.clone();
    store.inject_write_failure(true);
    assert_eq!(
        harness.runs.confirm_submission(&run),
        Err("agent_storage_unavailable".into())
    );
    harness.runs = AgentRunState::load(store.clone())?;
    harness.permissions = AgentPermissionState::default();
    let candidate = harness.runs.active_record(&run)?;
    assert!(candidate.initial_input.is_some());
    let native_deadline = Instant::now() + Duration::from_secs(20);
    while !harness
        .client
        .snapshot(&session)?
        .iter()
        .any(|message| message.id == run)
        && Instant::now() < native_deadline
    {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(harness
        .client
        .snapshot(&session)?
        .iter()
        .any(|message| message.id == run));
    assert!(
        super::recovery::confirm_from_native_with(&harness.runs, &candidate, || harness
            .client
            .snapshot(&session))
        .is_err()
    );
    assert!(harness.runs.active_record(&run)?.initial_input.is_some());
    store.inject_write_failure(false);
    assert!(super::recovery::confirm_from_native_with(
        &harness.runs,
        &candidate,
        || harness.client.snapshot(&session)
    )?);
    harness
        .permissions
        .ensure_run_registered(&harness.runs.active_record(&run)?, &[])?;

    let pending_deadline = Instant::now() + Duration::from_secs(20);
    while harness.permissions.waiting(&run)?.is_empty() && Instant::now() < pending_deadline {
        harness.tick_with_archive_failure(true)?;
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(harness.permissions.waiting(&run)?.len(), 1);
    let hold = Instant::now();
    while hold.elapsed() < Duration::from_secs(31) {
        harness.tick_with_archive_failure(true)?;
        assert!(harness.runs.active_record(&run)?.error_summary.is_none());
        assert_eq!(harness.permissions.waiting(&run)?.len(), 1);
        std::thread::sleep(Duration::from_millis(250));
    }
    println!(
        "NATIVE_AUDIT_PASS confirmation recovery without replay; archive failure held {}ms",
        hold.elapsed().as_millis()
    );
    let request = harness.permissions.waiting(&run)?[0].request.clone();
    let owned = harness.permissions.take_reply(&run, &request.id)?;
    respond_scoped(&harness.base, &owned, Reply::Once, &harness.workspace)?;
    wait_failed_archive_terminal(&harness, &run, RunOutcome::Completed)?;
    assert_eq!(
        fs::read_to_string(harness.workspace.join("command.exit"))?,
        "0"
    );
    println!(
        "NATIVE_AUDIT_PASS approved tool executes and completes while history remains blocked"
    );

    // A fresh native session avoids reusing the previous tool result.
    for (marker, cancel) in [("QA_SHELL", false), ("QA_ABORT", true)] {
        let session = harness.client.create_session(&harness.workspace)?;
        let run = harness.start(&session, marker)?;
        if cancel {
            let deadline = Instant::now() + Duration::from_secs(20);
            while !harness.client.is_busy(&session)? && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(harness.client.is_busy(&session)?);
            harness
                .client
                .settle_tools(&session, &run, "agent_cancelled")?;
            assert!(!harness.client.is_busy(&session)?);
            harness.runs.request_finish(
                &run,
                RunOutcome::Cancelled,
                Some("agent_cancelled".into()),
            )?;
            wait_failed_archive_terminal(&harness, &run, RunOutcome::Cancelled)?;
            println!("NATIVE_AUDIT_PASS confirmed native cancel clears host ownership despite archive failure");
        } else {
            let deadline = Instant::now() + Duration::from_secs(20);
            while harness.permissions.waiting(&run)?.is_empty() && Instant::now() < deadline {
                harness.tick_with_archive_failure(true)?;
                std::thread::sleep(Duration::from_millis(100));
            }
            let request = harness.permissions.waiting(&run)?[0].request.clone();
            let owned = harness.permissions.take_reply(&run, &request.id)?;
            respond_scoped(&harness.base, &owned, Reply::Reject, &harness.workspace)?;
            wait_failed_archive_terminal(&harness, &run, RunOutcome::Completed)?;
            assert!(harness
                .client
                .snapshot(&session)?
                .iter()
                .flat_map(|message| &message.parts)
                .any(|part| part
                    .state
                    .as_ref()
                    .is_some_and(|state| state.status == "error")));
            println!(
                "NATIVE_AUDIT_PASS rejection produces terminal tool error and clears ownership"
            );
        }
    }
    let session = harness.client.create_session(&harness.workspace)?;
    let run = harness.start(&session, "plain synthetic completion")?;
    wait_failed_archive_terminal(&harness, &run, RunOutcome::Completed)?;
    println!("NATIVE_AUDIT_PASS subsequent run can start and complete");
    Ok(())
}

fn wait_failed_archive_terminal(
    harness: &LiveHarness,
    run: &str,
    outcome: RunOutcome,
) -> TestResult<()> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while harness.runs.read()?.active.is_some() && Instant::now() < deadline {
        harness.tick_with_archive_failure(true)?;
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(harness.runs.read()?.active.is_none(), "host active cleared");
    assert!(
        harness.permissions.waiting(run).is_err(),
        "approval ownership cleared"
    );
    let persisted = harness
        .runs
        .store
        .load()?
        .into_iter()
        .find(|record| record.run_id == run)
        .checked("durable terminal")?;
    assert_eq!(persisted.outcome, Some(outcome));
    assert!(harness.archive.join("blocked-history").is_file());
    assert!(!harness
        .archive
        .join("blocked-history/history.json")
        .exists());
    Ok(())
}
