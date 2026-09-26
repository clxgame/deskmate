use tauri::{Emitter, Manager};
use super::{catalog::CatalogStore, catalog_import, catalog_model::*, catalog_query::*, native_api::{authorize_history_window, NativeHistoryClient}, HistoryState};

pub(crate) fn store(app: &tauri::AppHandle) -> Result<CatalogStore, String> {
    CatalogStore::open(&app.path().app_data_dir().map_err(|_| "history_catalog_unavailable")?.join("history-catalog.sqlite"))
}
pub(crate) fn client(app: &tauri::AppHandle) -> Result<NativeHistoryClient, String> {
    NativeHistoryClient::new(&crate::sidecar_url(app), &crate::sidecar_auth_header(app)).map_err(|error| error.to_string())
}
pub(crate) fn now() -> Result<u64, String> {
    u64::try_from(chrono::Utc::now().timestamp_millis()).map_err(|_| "history_clock_invalid".into())
}
pub(crate) fn workspace(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(catalog_import::canonical_directory(&app.path().app_data_dir().map_err(|_| "history_catalog_unavailable")?.join("workspace").to_string_lossy()))
}
pub(crate) fn register_known_directory(app: &tauri::AppHandle, directory: &str) -> Result<(), String> {
    let path = std::path::Path::new(directory).canonicalize().map_err(|_| "history_directory_unavailable")?;
    if !path.is_dir() { return Err("history_directory_unavailable".into()); }
    store(app)?.register_directory(&catalog_import::canonical_directory(&path.to_string_lossy()))
}
pub(crate) fn authorize_directory(app: &tauri::AppHandle, directory: Option<&str>) -> Result<String, String> {
    let default = workspace(app)?;
    let directory = directory.map(catalog_import::canonical_directory).unwrap_or_else(|| default.clone());
    if directory != default && !store(app)?.directories()?.contains(&directory) { return Err("history_directory_unknown".into()); }
    Ok(directory)
}
pub(crate) fn apply_ownership(app: &tauri::AppHandle, rows: &mut [CatalogEntry]) -> Result<(), String> {
    for row in rows {
        if let CatalogIdentity::Native { directory, session_id, .. } = &row.identity {
            if row.ownership != Ownership::Agent {
                row.ownership = if app.state::<crate::workbench::WorkbenchOwnership>().is_owned(directory, session_id)? { Ownership::Workbench } else { Ownership::Unowned };
            }
        }
    }
    Ok(())
}
pub(crate) fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let store = store(app)?;
    let workspace = workspace(app)?;
    store.register_directory(&workspace)?;
    let sessions = app.state::<HistoryState>().0.lock().map_err(|_| "history_state_unavailable")?.clone();
    let index = app.state::<super::NativeSessionIndex>().0.lock().map_err(|_| "native_session_index_unavailable")?.clone();
    let records = app.state::<crate::agent::AgentRunState>().all_records()?;
    for row in &index { store.register_directory(&catalog_import::canonical_directory(&row.workspace_path))?; }
    for record in &records { store.register_directory(&catalog_import::canonical_directory(&record.workspace_path.to_string_lossy()))?; }
    catalog_import::register_sources(&store, &sessions, &index, &workspace, &records)
}

#[tauri::command]
pub(crate) async fn history_catalog_list(window: tauri::WebviewWindow, app: tauri::AppHandle, query: CatalogQuery, refresh: Option<bool>) -> Result<CatalogPage, String> {
    authorize_history_window(window.label()).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        initialize(&app)?;
        let store = store(&app)?;
        let errors = if refresh.unwrap_or(false) { refresh_history(&app)? } else { Vec::new() };
        let mut rows = store.all()?; apply_ownership(&app, &mut rows)?;
        Ok(page(rows, query, store.directories()?, errors))
    }).await.map_err(|_| "history_catalog_unavailable".to_owned())?
}

pub(crate) fn register_native(app: &tauri::AppHandle, session_id: &str, source: &str, directory: Option<&str>) -> Result<CatalogRow, String> {
    let source = match source { "light_chat" => ConversationSource::LightChat, "workbench" => ConversationSource::Workbench, _ => return Err("native_session_metadata_invalid".into()) };
    let directory = directory.map(catalog_import::canonical_directory).unwrap_or(workspace(app)?);
    let native = client(app)?.get(&directory, session_id).map_err(|error| error.to_string())?;
    if native.parent_id.is_some() { return Err("history_child_session".into()); }
    let store = store(app)?;
    store.register_directory(&directory)?;
    let identity = CatalogIdentity::Native { sidecar_id: SIDECAR_ID.into(), directory, session_id: session_id.into() };
    let result = store.update(|rows| {
        if let Some(row) = rows.iter().find(|row| row.key() == identity.key()) { return Ok(row.clone()); }
        let mut row = catalog_import::new_entry(identity, native.title, source, native.time.created, native.time.updated);
        row.availability = Availability::Available;
        row.runtime = RuntimeState::Unknown;
        rows.push(row.clone()); Ok(row)
    })?;
    app.emit("history-catalog-changed", ()).map_err(|_| "history_event_unavailable")?;
    Ok(result.into())
}

#[tauri::command]
pub(crate) async fn history_catalog_load(window: tauri::WebviewWindow, app: tauri::AppHandle, key: String) -> Result<CatalogLoaded, String> {
    authorize_history_window(window.label()).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        initialize(&app)?;
        let store = store(&app)?;
        let entry = store.get(&key)?;
        if entry.tombstone.is_some() { return Err("history_deleted".into()); }
        match &entry.identity {
            CatalogIdentity::Legacy { history_id } => {
                let session = app.state::<HistoryState>().0.lock().map_err(|_| "history_state_unavailable")?.iter().find(|session| &session.id == history_id && !session.deleted).ok_or("history_not_found")?.clone();
                let agent_details = super::catalog_details::for_entry(&entry, &app.state::<crate::agent::AgentRunState>().all_records()?, session.origin_run_id.as_deref());
                Ok(CatalogLoaded { entry: entry.into(), messages: session.messages, agent_details, origin_run_id: session.origin_run_id })
            }
            CatalogIdentity::Native { directory, session_id, .. } => {
                let client = client(&app)?;
                let native = client.get(directory, session_id).map_err(|error| error.to_string())?;
                let statuses = client.statuses(directory);
                super::reconcile::apply_discovery(&store, directory, &[native], statuses.as_ref().ok(), &app.state::<crate::agent::AgentRunState>().all_records()?, false)?;
                let messages = crate::agent::read_session_snapshot(&app, std::path::Path::new(directory), session_id)?.into_iter().flat_map(|message| {
                    let role = message.role.unwrap_or_default(); let time = message.created.unwrap_or(0);
                    message.parts.into_iter().filter(|part| part.kind.as_deref() == Some("text")).filter_map(move |part| Some(super::HistoryMessage { local_only: false, role: role.clone(), text: part.text?, time, message_id: Some(message.id.clone()), part_id: Some(part.id) }))
                }).collect();
                let mut rows = vec![store.get(&key)?]; apply_ownership(&app, &mut rows)?;
                let entry = rows.remove(0);
                let agent_details = super::catalog_details::for_entry(&entry, &app.state::<crate::agent::AgentRunState>().all_records()?, None);
                let origin_run_id = super::catalog_details::native_origin(&entry, &app.state::<crate::agent::AgentRunState>().all_records()?);
                let local = app.state::<HistoryState>().0.lock().map_err(|_| "history_state_unavailable")?.clone();
                let (entry, messages) = super::catalog_local::combine_messages(entry.into(), messages, &local, &workspace(&app)?);
                Ok(CatalogLoaded { entry, messages, agent_details, origin_run_id })
            }
        }
    }).await.map_err(|_| "history_load_unavailable".to_owned())?
}







fn refresh_history(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let runs = app.state::<crate::agent::AgentRunState>();
    let _operation = runs.lock_operation()?;
    let errors = super::reconcile::reconcile(&store(app)?, &client(app)?, &runs.all_records()?)?;
    super::catalog_preview::invalidate_all();
    initialize(app)?;
    Ok(errors)
}

pub(crate) fn refresh_after_ready(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let refreshed = (|| -> Result<(), String> {
            if crate::agent::managed_sidecar_ready(&app)? {
                for error in refresh_history(&app)? { eprintln!("history startup refresh: {error}"); }
            } else {
                let store = store(&app)?;
                for directory in store.directories()? { super::reconcile::mark_unavailable(&store, &directory)?; }
            }
            app.emit("history-catalog-changed", ()).map_err(|_| "history_event_unavailable".to_owned())
        })();
        if let Err(error) = refreshed { eprintln!("history startup refresh: {error}"); }
    });
}
