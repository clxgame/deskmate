mod lazy_tests;
mod startup_tests;

use crate::agent::{NativeMessage, NativePart, RunOutcome, RunRecord};
use std::path::Path;

fn record(run_id: &str, session_id: Option<&str>, workspace: &Path, created_at: &str) -> RunRecord {
    RunRecord {
        run_id: run_id.to_owned(),
        session_id: session_id.map(str::to_owned),
        workspace_path: workspace.to_path_buf(),
        created_at: created_at.to_owned(),
        ended_at: Some(created_at.to_owned()),
        outcome: Some(RunOutcome::Completed),
        error_summary: None,
        pending_outcome: None,
        pending_error_summary: None,
        message_ids: Vec::new(),
        part_ids: Vec::new(),
        call_ids: Vec::new(),
        initial_input: None,
    }
}

fn text_message(id: &str, role: &str, text: &str, created: u64) -> NativeMessage {
    NativeMessage {
        id: id.to_owned(),
        role: Some(role.to_owned()),
        created: Some(created),
        parent_id: None,
        completed: true,
        finish: Some("stop".to_owned()),
        error: None,
        parts: vec![NativePart {
            id: format!("prt_{id}"),
            kind: Some("text".to_owned()),
            text: Some(text.to_owned()),
            call_id: None,
            tool: None,
            state: None,
        }],
    }
}
