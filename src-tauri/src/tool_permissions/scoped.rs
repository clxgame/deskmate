use super::runtime::{pending_url, respond_url, PermissionRequest, Reply};
use std::path::Path;
use tauri::Manager;

pub(crate) fn pending_scoped(
    base: &str,
    directory: &Path,
) -> Result<Vec<PermissionRequest>, String> {
    pending_url(&permission_url(base, "/permission", directory)?)
}

pub(crate) fn pending_scoped_live(
    app: &tauri::AppHandle,
    directory: &Path,
    session: &str,
) -> Result<Vec<PermissionRequest>, String> {
    app.state::<super::events::PermissionEvents>()
        .pending_scoped(&super::runtime::endpoint(app), directory, session)
}

pub(crate) fn respond_scoped(
    base: &str,
    request: &PermissionRequest,
    reply: Reply,
    directory: &Path,
) -> Result<(), String> {
    respond_url(
        &permission_url(
            base,
            &format!("/permission/{}/reply", request.id),
            directory,
        )?,
        request,
        reply,
    )
}

fn permission_url(base: &str, path: &str, directory: &Path) -> Result<String, String> {
    let mut url = url::Url::parse(&format!("{base}{path}"))
        .map_err(|_| "permission_unavailable".to_owned())?;
    url.query_pairs_mut().append_pair(
        "directory",
        &crate::agent::opencode_wire_directory(directory),
    );
    Ok(url.into())
}
