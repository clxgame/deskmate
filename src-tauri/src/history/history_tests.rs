mod archive_tests;
mod ownership_tests;
mod recovery_tests;
mod storage_tests;

use super::{HistoryMessage, HistorySession};
use std::path::PathBuf;

pub(super) fn temp_file(label: &str) -> PathBuf {
    std::env::temp_dir()
        .join(format!("yume-history-{label}-{}", uuid::Uuid::new_v4()))
        .join("history.json")
}

pub(super) fn ordinary(id: &str) -> HistorySession {
    HistorySession {
        id: id.to_owned(),
        title: "chat".to_owned(),
        created: 1,
        updated: 1,
        messages: vec![HistoryMessage {
            role: "user".to_owned(),
            text: "hello".to_owned(),
            time: 1,
            message_id: None,
            part_id: None,
        }],
        origin_run_id: None,
        deleted: false,
    }
}

pub(super) fn agent(id: &str) -> HistorySession {
    HistorySession {
        origin_run_id: Some("msg_origin".to_owned()),
        messages: Vec::new(),
        ..ordinary(id)
    }
}
