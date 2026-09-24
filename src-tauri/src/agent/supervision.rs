use super::{
    opencode::OpenCodeClient,
    record_store::{NativeMessage, RunOutcome, RunRecord},
    AgentRunState,
};

// Bash itself caps execution at ten minutes. Include the five-minute approval
// budget and a minute for native cancellation/result persistence.
const TOOL_LIFECYCLE_MS: u64 = 16 * 60 * 1000;
const IDLE_GRACE_MS: u64 = 10_000;

pub(super) fn in_flight(message: &NativeMessage) -> bool {
    message.parts.iter().any(|part| {
        part.state
            .as_ref()
            .is_some_and(|state| matches!(state.status.as_str(), "pending" | "running"))
    })
}

pub(super) fn snapshot(
    client: &OpenCodeClient,
    state: &AgentRunState,
    record: &RunRecord,
) -> Result<Vec<NativeMessage>, String> {
    let session = record
        .session_id
        .as_deref()
        .ok_or("agent_session_unknown")?;
    let messages = client.snapshot(session)?;
    let now =
        u64::try_from(chrono::Utc::now().timestamp_millis()).map_err(|_| "history_time_invalid")?;
    let owned = messages
        .iter()
        .filter(|message| message.parent_id.as_deref() == Some(&record.run_id))
        .collect::<Vec<_>>();
    let oldest = owned
        .iter()
        .filter(|message| in_flight(message))
        .filter_map(|message| message.created)
        .min();
    let Some(oldest) = oldest else {
        return Ok(messages);
    };
    if record.pending_outcome.is_some() {
        let _operation = state.lock_operation()?;
        if !state.matches_active(record)? {
            return Ok(messages);
        }
        if client.is_busy(session)? {
            return Err("agent_tools_unsettled".into());
        }
        return client.settle_tools(
            session,
            &record.run_id,
            record
                .pending_error_summary
                .as_deref()
                .unwrap_or("agent_cancelled"),
        );
    }
    if now.saturating_sub(oldest) < IDLE_GRACE_MS {
        return Ok(messages);
    }
    let busy = client.is_busy(session)?;
    let reason = if !busy {
        "agent_execution_lost"
    } else if now.saturating_sub(oldest) >= TOOL_LIFECYCLE_MS {
        "agent_tool_timeout"
    } else {
        return Ok(messages);
    };
    let _operation = state.lock_operation()?;
    if !state.matches_active(record)? {
        return Ok(messages);
    }
    if busy {
        // The host owns process isolation; an HTTP abort alone is insufficient.
        return Err(reason.into());
    }
    let settled = client.settle_tools(session, &record.run_id, reason)?;
    eprintln!("agent run {}: {reason}", record.run_id);
    state.request_finish(
        &record.run_id,
        if busy {
            RunOutcome::Failed
        } else {
            RunOutcome::Interrupted
        },
        Some(reason.into()),
    )?;
    Ok(settled)
}

pub(super) fn collection_failed(
    app: &tauri::AppHandle,
    record: &RunRecord,
    error: &str,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<AgentRunState>();
    if !state.matches_active(record)? {
        return Ok(());
    }
    let expired = {
        let mut failure = state
            .collection_failure
            .lock()
            .map_err(|_| "agent_state_unavailable")?;
        let (id, since) =
            failure.get_or_insert_with(|| (record.run_id.clone(), std::time::Instant::now()));
        if id != &record.run_id {
            *id = record.run_id.clone();
            *since = std::time::Instant::now();
        }
        since.elapsed() >= std::time::Duration::from_secs(30)
    };
    if !expired && matches!(error, "agent_read_failed" | "history_storage_failed") {
        return Ok(());
    }
    let _operation = state.lock_operation()?;
    if !state.matches_active(record)? {
        return Ok(());
    }
    let current = state.active_record(&record.run_id)?;
    if current.pending_outcome != record.pending_outcome {
        return Ok(());
    }
    let session = record
        .session_id
        .as_deref()
        .ok_or("agent_session_unknown")?;
    let messages = settle(app, record, error)?;
    eprintln!("agent run {} stopped: {error}", record.run_id);
    if let Err(archive_error) = crate::history::save_agent_snapshot(
        app,
        &record.workspace_path,
        crate::history::AgentHistorySnapshot {
            session_id: session,
            messages: &messages,
        },
    ) {
        eprintln!("agent failure archive: {archive_error}");
    }
    state.finish(
        &record.run_id,
        current.pending_outcome.unwrap_or(RunOutcome::Failed),
        current.pending_error_summary.or_else(|| Some(error.into())),
    )?;
    if let Err(error) = app
        .state::<super::AgentPermissionState>()
        .cancel_run(&record.run_id)
    {
        if error != "agent_run_unknown" {
            return Err(error);
        }
    }
    Ok(())
}

pub(super) fn settle(
    app: &tauri::AppHandle,
    record: &RunRecord,
    reason: &str,
) -> Result<Vec<NativeMessage>, String> {
    let session = record
        .session_id
        .as_deref()
        .ok_or("agent_session_unknown")?;
    let settings = super::run_commands::current_start_settings(app)?;
    let client = super::run_commands::lifecycle_client(app, &settings, &record.workspace_path);
    match client.settle_tools(session, &record.run_id, reason) {
        Ok(messages) => Ok(messages),
        Err(error) => {
            eprintln!(
                "agent settlement for {}: {error}; isolating owned sidecar",
                record.run_id
            );
            use tauri::Manager;
            let state = app.state::<AgentRunState>();
            let pending = state.active_record(&record.run_id)?;
            stop_owned_process_tree(app)?;
            crate::restart_sidecar(app)?;
            if let Some(outcome) = pending.pending_outcome {
                state.request_finish(&record.run_id, outcome, pending.pending_error_summary)?;
            }
            if !client.wait_ready(super::opencode::READY_TIMEOUT) {
                return Err("agent_sidecar_unavailable".into());
            }
            client.settle_tools(session, &record.run_id, reason)
        }
    }
}

fn stop_owned_process_tree(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let sidecar = app.state::<crate::Sidecar>();
    let mut owned = sidecar.child.lock().map_err(|_| "sidecar lock poisoned")?;
    let Some(child) = owned.as_mut() else {
        return Ok(());
    };
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(());
    }
    terminate_process_tree(child.id())?;
    child.wait().map_err(|error| error.to_string())?;
    *owned = None;
    Ok(())
}

pub(super) fn terminate_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::windows_process_tree::terminate(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Err("agent_process_isolation_unavailable".into())
    }
}
pub(super) fn submission_failed(
    app: &tauri::AppHandle,
    record: &RunRecord,
    error: &str,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<AgentRunState>();
    eprintln!("agent submission {}: {error}", record.run_id);
    // A transport error does not establish whether the server accepted the turn.
    state.confirm_submission(&record.run_id)?;
    state.request_finish(&record.run_id, RunOutcome::Failed, Some(error.into()))?;
    state.set_collection_error(&record.run_id, Some(error))?;
    let messages = settle(app, record, error)?;
    crate::history::save_agent_snapshot(
        app,
        &record.workspace_path,
        crate::history::AgentHistorySnapshot {
            session_id: record
                .session_id
                .as_deref()
                .ok_or("agent_session_unknown")?,
            messages: &messages,
        },
    )?;
    state.fail_active(&record.run_id, error)?;
    if let Err(error) = app
        .state::<super::AgentPermissionState>()
        .cancel_run(&record.run_id)
    {
        if error != "agent_run_unknown" {
            return Err(error);
        }
    }
    Ok(())
}

