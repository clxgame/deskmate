use super::{
    run_commands::StartSettings,
    test_support::{Checked, TestResult},
};
use std::sync::{Arc, Mutex};

use crate::agent::{AgentPermissionState, AgentRunState, RunStore};
use crate::history::{HistorySession, HistoryState};

#[test]
fn start_settings_snapshot_cannot_mix_identity_after_concurrent_mutation() -> TestResult<()> {
    let mut initial = crate::settings::Settings::default();
    initial.provider_id = "provider-before".into();
    initial.model_id = "model-before".into();
    initial.persona_id = "persona-before".into();
    initial.memory_ai_use = true;
    let shared = Arc::new(Mutex::new(initial));
    let captured = {
        let settings = shared.lock().checked("lock initial settings")?;
        StartSettings::from(&*settings)
    };
    let concurrent = Arc::clone(&shared);
    std::thread::spawn(move || -> TestResult<()> {
        let mut settings = concurrent.lock().checked("lock changed settings")?;
        settings.provider_id = "provider-after".into();
        settings.model_id = "model-after".into();
        settings.persona_id = "persona-after".into();
        settings.memory_ai_use = false;
        Ok(())
    })
    .join()
    .checked("join settings mutation")??;
    let changed = {
        let settings = shared.lock().checked("read changed settings")?;
        StartSettings::from(&*settings)
    };
    assert_ne!(captured, changed);
    assert_eq!(captured.provider_id, "provider-before");
    assert_eq!(captured.model_id, "model-before");
    assert_eq!(captured.persona_id, "persona-before");
    assert!(captured.memory_ai_use);
    Ok(())
}

#[test]
fn history_failure_releases_slot_and_permission_but_preserves_input() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-history-run-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace)?;
    let state = AgentRunState::new(RunStore::new(root.join("runs")));
    let permissions = AgentPermissionState::default();
    state.begin("msg_history", &workspace, "retry me")?;
    state.bind_session_with("msg_history", "ses_history", || {
        permissions.register_run("msg_history", "ses_history", &workspace)
    })?;
    let result: Result<(), String> =
        super::run_commands::fail_history_start(&state, &permissions, "msg_history");
    assert_eq!(result, Err("history_storage_failed".to_owned()));
    let listing = state.read()?;
    assert!(listing.active.is_none());
    assert_eq!(listing.recent.len(), 1);
    assert_eq!(listing.recent[0].initial_input.as_deref(), Some("retry me"));
    assert_eq!(
        listing.recent[0].error_summary.as_deref(),
        Some("history_storage_failed")
    );
    assert_eq!(
        permissions.cancel_run("msg_history"),
        Err("agent_run_unknown".to_owned())
    );
    std::fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn history_start_uses_only_the_persisted_session_workspace_pair() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-history-target-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace)?;
    let runs = AgentRunState::new(RunStore::new(root.join("runs")));
    runs.begin("msg_origin", &workspace, "first")?;
    runs.bind_session("msg_origin", "ses_history")?;
    runs.fail_active("msg_origin", "done")?;
    let history = HistoryState(Mutex::new(vec![HistorySession {
        local_link: None,
        id: "ses_history".into(),
        title: "first".into(),
        created: 1,
        updated: 1,
        messages: Vec::new(),
        origin_run_id: Some("msg_origin".into()),
        deleted: false,
    }]));
    let target = super::continuation::start_target(
        &super::run_commands::AgentStartInput {
            workspace_path: None,
            history_id: Some("ses_history".into()),
            catalog_key: None,
            input: "again".into(),
        },
        &history,
        &runs,
    )?;
    assert_eq!(target.session_id.as_deref(), Some("ses_history"));
    assert_eq!(target.workspace, workspace.canonicalize()?);
    runs.begin("msg_second", &target.workspace, "again")?;
    runs.bind_session(
        "msg_second",
        target
            .session_id
            .as_deref()
            .ok_or_else(|| "missing continuation session".to_owned())?,
    )?;
    let second = runs
        .read()?
        .active
        .ok_or_else(|| "missing second run".to_owned())?;
    assert_eq!(second.run_id, "msg_second");
    assert_eq!(second.session_id.as_deref(), Some("ses_history"));
    assert_eq!(
        runs.origin_run_for_session("ses_history")?.as_deref(),
        Some("msg_origin")
    );
    assert_eq!(
        super::continuation::start_target(
            &super::run_commands::AgentStartInput {
                workspace_path: Some(workspace.clone()),
                history_id: Some("ses_history".into()),
                catalog_key: None,
                input: "spoof".into()
            },
            &history,
            &runs,
        )
        .map(|_| ()),
        Err("agent_history_workspace_spoof".into())
    );
    std::fs::remove_dir_all(root)?;
    Ok(())
}

