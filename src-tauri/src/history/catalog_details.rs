use super::{catalog_import::canonical_directory, catalog_model::CatalogEntry, catalog_model::CatalogIdentity, recovery::{self, AgentHistoryDetails, DetailAvailability}};
use crate::agent::RunRecord;

pub(super) fn for_entry(entry: &CatalogEntry, records: &[RunRecord], origin: Option<&str>) -> Option<AgentHistoryDetails> {
    let (id, directory) = match &entry.identity {
        CatalogIdentity::Native { session_id, directory, .. } => (session_id.as_str(), directory.clone()),
        CatalogIdentity::Legacy { history_id } => {
            let origin = origin?;
            let record = records.iter().find(|record| record.run_id == origin && record.session_id.as_deref() == Some(history_id))?;
            (history_id.as_str(), canonical_directory(&record.workspace_path.to_string_lossy()))
        }
    };
    let scoped: Vec<_> = records.iter().filter(|record| record.session_id.as_deref() == Some(id)
        && canonical_directory(&record.workspace_path.to_string_lossy()) == directory).cloned().collect();
    let availability = if std::path::Path::new(&directory).is_dir() { DetailAvailability::Ready } else { DetailAvailability::WorkspaceMissing };
    recovery::details_for(&scoped, id, availability)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{catalog_import::new_entry, catalog_model::ConversationSource, catalog_query::CatalogLoaded};

    #[test]
    fn loaded_agent_details_are_scoped_and_serialized_for_native_history() {
        // Given colliding IDs in two recorded projects, with the other project newer.
        let records: Vec<RunRecord> = serde_json::from_value(serde_json::json!([
            {"runId":"msg_schedule_a", "sessionId":"ses_same", "workspacePath":"C:/project-a", "createdAt":"2026-09-23T00:00:00Z", "outcome":"completed"},
            {"runId":"msg_b", "sessionId":"ses_same", "workspacePath":"C:/project-b", "createdAt":"2026-09-24T00:00:00Z", "outcome":null}
        ])).unwrap();
        let entry = new_entry(CatalogIdentity::Native { sidecar_id:"managed-local-v1".into(), directory:"c:/project-a".into(), session_id:"ses_same".into() }, "Agent".into(), ConversationSource::Workbench, 1, 2);
        // When the catalog load response is encoded for the renderer.
        let loaded = CatalogLoaded { origin_run_id: native_origin(&entry, &records), agent_details: for_entry(&entry, &records, None), entry: entry.into(), messages: Vec::new() };
        let value = serde_json::to_value(loaded).unwrap();
        // Then scoped completion and scheduled provenance survive the wire contract.
        assert_eq!(value["agentDetails"]["status"], "completed");
        assert_eq!(value["originRunId"], "msg_schedule_a");
        assert_eq!(value["agentDetails"]["source"], "scheduled");
        assert_eq!(value["agentDetails"]["workspacePath"], "C:/project-a");
    }

    #[test]
    fn legacy_details_require_trusted_origin_even_when_bare_id_matches() {
        // Given an ordinary legacy row whose bare ID collides with an agent record.
        let records: Vec<RunRecord> = serde_json::from_value(serde_json::json!([
            {"runId":"msg_agent", "sessionId":"same", "workspacePath":"C:/project", "createdAt":"2026-09-23T00:00:00Z", "outcome":"completed"}
        ])).unwrap();
        let entry = new_entry(CatalogIdentity::Legacy { history_id: "same".into() }, "Legacy".into(), ConversationSource::Legacy, 1, 2);
        // When no trusted origin links the legacy record to that native project.
        let details = for_entry(&entry, &records, None);
        // Then the renderer cannot treat unrelated text as an agent recovery snapshot.
        assert!(details.is_none());
    }
}


pub(super) fn native_origin(entry: &CatalogEntry, records: &[RunRecord]) -> Option<String> {
    let CatalogIdentity::Native { sidecar_id, directory, session_id } = &entry.identity else { return None; };
    if sidecar_id != super::catalog_model::SIDECAR_ID { return None; }
    records.iter().filter(|record| record.session_id.as_deref() == Some(session_id)
        && canonical_directory(&record.workspace_path.to_string_lossy()) == *directory)
        .min_by(|left, right| left.created_at.cmp(&right.created_at).then_with(|| left.run_id.cmp(&right.run_id)))
        .map(|record| record.run_id.clone())
}
