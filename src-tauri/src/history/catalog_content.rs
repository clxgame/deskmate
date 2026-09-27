use super::{
    catalog::CatalogStore,
    catalog_model::{Availability, CatalogEntry, CatalogIdentity, ConversationSource, Ownership, RuntimeState, SIDECAR_ID},
    native_api::NativeHistoryClient,
    HistorySession,
};

/// A local reply, legacy transcript, or Agent record is sufficient evidence.
/// Native IDs are scoped to a directory, so bare legacy IDs may only match
/// the registered light-chat workspace (the same rule as transcript loading).
pub(super) fn apply_local_evidence(rows: &mut [CatalogEntry], sessions: &[HistorySession], workspace: &str) {
    let workspace = super::catalog_import::canonical_directory(workspace);
    for row in rows {
        if row.ownership == Ownership::Agent {
            row.has_records = Some(true);
            continue;
        }
        let local: Vec<_> = sessions.iter().filter(|session| !session.deleted).filter(|session| {
            match &row.identity {
                CatalogIdentity::Legacy { history_id } => session.id == *history_id,
                CatalogIdentity::Native { sidecar_id, directory, session_id } => {
                    session.local_link.as_ref().is_some_and(|identity| identity.key() == row.key())
                        || (session.local_link.is_none() && row.source == ConversationSource::LightChat
                            && sidecar_id == SIDECAR_ID && *directory == workspace && session.id == *session_id)
                }
            }
        }).collect();
        if !local.is_empty() {
            if local.iter().any(|session| !session.messages.is_empty() || session.origin_run_id.is_some()) {
                row.has_records = Some(true);
            } else if matches!(row.identity, CatalogIdentity::Legacy { .. }) {
                row.has_records = Some(false);
            }
        }
    }
}

/// Upgrade old unverified entries and recheck draft sessions on each native
/// refresh. Once records exist, an unavailable/partial transcript cannot erase
/// that evidence. No remote deletion is issued: an open composer may still send.
pub(super) fn refresh(store: &CatalogStore, client: &NativeHistoryClient) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();
    for snapshot in store.all()? {
        if snapshot.tombstone.is_some() || snapshot.has_records == Some(true)
            || snapshot.availability != Availability::Available
            || snapshot.runtime != RuntimeState::Idle || snapshot.ownership == Ownership::Agent {
            continue;
        }
        let CatalogIdentity::Native { directory, session_id, .. } = &snapshot.identity else { continue; };
        match client.has_messages(directory, session_id) {
            Ok(has_records) => store.update(|rows| {
                if let Some(row) = rows.iter_mut().find(|row| row.key() == snapshot.key()) {
                    // A concurrent local save or running task takes precedence.
                    if row.has_records != Some(true) && row.updated == snapshot.updated
                        && row.runtime == RuntimeState::Idle && row.ownership != Ownership::Agent {
                        row.has_records = Some(has_records);
                    }
                }
                Ok(())
            })?,
            Err(error) => errors.push(error.to_string()),
        }
    }
    errors.sort();
    errors.dedup();
    Ok(errors)
}

#[cfg(test)]
#[path = "catalog_content_tests.rs"]
mod tests;
