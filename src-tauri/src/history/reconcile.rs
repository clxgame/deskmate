use std::collections::HashMap;
use super::{catalog::CatalogStore, catalog_import::{canonical_directory, new_entry}, catalog_model::*, native_api::{NativeHistoryClient, NativeSession, NativeStatus}};

pub(crate) fn reconcile(store: &CatalogStore, client: &NativeHistoryClient, records: &[crate::agent::RunRecord]) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();
    let mut current_statuses = HashMap::new();
    for directory in store.directories()? {
        let fetched = client.list_all(&directory);
        let statuses = client.statuses(&directory);
        if let Err(error) = &statuses { errors.push(error.to_string()); }
        match fetched {
            Ok(sessions) => {
                apply_discovery(store, &directory, &sessions, statuses.as_ref().ok(), records, true)?;
                if let Ok(statuses) = statuses { current_statuses.insert(directory.clone(), statuses); }
            }
            Err(error) => {
                errors.push(error.to_string());
                mark_unavailable(store, &directory)?;
            }
        }
    }
    // Tombstones commit before remote deletion; every successful refresh retries unconfirmed requests.
    for row in store.all()? {
        if row.tombstone.as_ref().is_none_or(|tombstone| tombstone.remote_deleted) { continue; }
        let CatalogIdentity::Native { directory, session_id, .. } = &row.identity else { continue; };
        let Some(statuses) = current_statuses.get(directory) else { continue; };
        if matches!(statuses.get(session_id), Some(NativeStatus::Busy | NativeStatus::Retry { .. })) { continue; }
        if records.iter().any(|record| record.outcome.is_none() && record.session_id.as_deref() == Some(session_id) && canonical_directory(&record.workspace_path.to_string_lossy()) == *directory) { continue; }
        match client.delete(directory, session_id) {
            Ok(()) => store.update(|rows| { if let Some(entry) = rows.iter_mut().find(|entry| entry.key() == row.key()) { if let Some(tombstone) = &mut entry.tombstone { tombstone.remote_deleted = true; } } Ok(()) })?,
            Err(error) => errors.push(error.to_string()),
        }
    }
    errors.sort(); errors.dedup(); Ok(errors)
}

pub(crate) fn apply_discovery(store: &CatalogStore, directory: &str, sessions: &[NativeSession], statuses: Option<&HashMap<String, NativeStatus>>, records: &[crate::agent::RunRecord], complete: bool) -> Result<(), String> {
    store.update(|rows| {
        if complete { for row in rows.iter_mut().filter(|row| matches!(&row.identity, CatalogIdentity::Native { directory: project, .. } if project == directory)) { row.availability = Availability::Unavailable; row.runtime = RuntimeState::Unknown; } }
        let mut indexes: HashMap<_, _> = rows.iter().enumerate().map(|(index, row)| (row.key(), index)).collect();
        for session in sessions {
            if session.parent_id.is_some() || canonical_directory(&session.directory) != directory { continue; }
            let identity = CatalogIdentity::Native { sidecar_id: SIDECAR_ID.into(), directory: directory.into(), session_id: session.id.clone() };
            identity.validate().map_err(|_| "history_identity_invalid")?;
            let index = *indexes.entry(identity.key()).or_insert_with(|| {
                let index = rows.len();
                rows.push(new_entry(identity, session.title.clone(), ConversationSource::Workbench, session.time.created, session.time.updated));
                index
            });
            let row = &mut rows[index];
            if row.tombstone.is_some() { continue; }
            row.title = session.title.clone(); row.created = session.time.created; row.updated = session.time.updated;
            row.availability = Availability::Available;
            // The pinned native server cannot restore an archived session; user archive is catalog-owned.

            row.runtime = match statuses.and_then(|statuses| statuses.get(&session.id)) {
                Some(NativeStatus::Busy | NativeStatus::Retry { .. }) => RuntimeState::Running,
                Some(NativeStatus::Idle) => RuntimeState::Idle,
                None if statuses.is_some() => RuntimeState::Idle,
                None => RuntimeState::Unknown,
            };
            let matching: Vec<_> = records.iter().filter(|record| record.session_id.as_deref() == Some(&session.id) && canonical_directory(&record.workspace_path.to_string_lossy()) == directory).collect();
            if !matching.is_empty() { row.ownership = Ownership::Agent; }
            if matching.iter().any(|record| record.outcome.is_none()) { row.runtime = RuntimeState::Running; }
        }
        Ok(())
    })
}

pub(crate) fn mark_unavailable(store: &CatalogStore, directory: &str) -> Result<(), String> {
    store.update(|rows| { for row in rows { if matches!(&row.identity, CatalogIdentity::Native { directory: project, .. } if project == directory) { row.availability = Availability::Unavailable; row.runtime = RuntimeState::Unknown; } } Ok(()) })
}



