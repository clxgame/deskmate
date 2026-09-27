use super::*;
use crate::tool_permissions::runtime::PermissionRequest;

#[derive(Clone, Debug)]
pub(crate) struct ReadScope {
    pub path: PathBuf,
    pub directory: bool,
    pub read_base: Option<PathBuf>,
}

impl ReadScope {
    fn allows(&self, path: &Path) -> bool {
        let Ok(root) = self.path.canonicalize() else {
            return false;
        };
        if root != self.path {
            return false;
        }
        if (self.directory && !root.is_dir()) || (!self.directory && !root.is_file()) {
            return false;
        }
        let Ok(target) = path.canonicalize() else {
            return false;
        };
        if self.directory {
            target.starts_with(&root)
        } else {
            target == root
        }
    }
}

pub(crate) fn allows_request(
    scopes: &[ReadScope],
    cwd: &Path,
    request: &PermissionRequest,
) -> bool {
    if scopes.is_empty() {
        return false;
    }
    let resolve = |value: &str| {
        let path = Path::new(value);
        if path.is_absolute() {
            path.to_owned()
        } else {
            cwd.join(path)
        }
    };
    match request.permission.as_str() {
        "read" => {
            !request.patterns.is_empty()
                && request.patterns.iter().all(|value| {
                    !value.is_empty()
                        && scopes.iter().any(|scope| {
                            let path = Path::new(value);
                            let target = if path.is_absolute() {
                                path.to_owned()
                            } else {
                                scope.read_base.as_deref().unwrap_or(cwd).join(path)
                            };
                            scope.allows(&target)
                        })
                })
        }
        "glob" | "grep" | "list" => request
            .metadata
            .get("path")
            .and_then(|p| p.as_str())
            .filter(|p| !p.is_empty())
            .is_some_and(|path| {
                let path = resolve(path);
                scopes
                    .iter()
                    .any(|scope| scope.directory && scope.allows(&path))
                    && tree_without_links(&path)
            }),
        // OpenCode checks the parent directory before the read permission. Passing this gate
        // grants no read by itself: the following read/list permission is still checked above.
        "external_directory" => {
            !request.patterns.is_empty()
                && request.patterns.iter().all(|pattern| {
                    let value = pattern
                        .strip_suffix("/*")
                        .or_else(|| pattern.strip_suffix("\\*"))
                        .unwrap_or(pattern);
                    if value.is_empty() || value.contains(['*', '?']) {
                        return false;
                    }
                    let Ok(target) = resolve(value).canonicalize() else {
                        return false;
                    };
                    scopes.iter().any(|scope| {
                        (scope.directory && scope.allows(&target))
                            || (scope.path.parent().is_some_and(|parent| parent == target)
                                && scope.allows(&scope.path))
                    })
                })
        }
        _ => false,
    }
}

fn tree_without_links(root: &Path) -> bool {
    let mut pending = vec![root.to_owned()];
    let mut inspected = 0usize;
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            return false;
        };
        for entry in entries {
            inspected += 1;
            if inspected > 20_000 {
                return false;
            }
            let Ok(entry) = entry else {
                return false;
            };
            let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
                return false;
            };
            if meta.file_type().is_symlink() {
                return false;
            }
            if meta.is_dir() {
                pending.push(entry.path());
            }
        }
    }
    true
}

pub(crate) fn enable_session_reads(
    app: &tauri::AppHandle,
    directory: &str,
    session: &str,
) -> Result<PathBuf, String> {
    let mut url = url::Url::parse(&format!("{}/session/{session}", crate::sidecar_url(app)))
        .map_err(|_| "resource_permission_failed")?;
    url.query_pairs_mut().append_pair("directory", directory);
    let client = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(15))
        .build();
    let mut path_url = url::Url::parse(&format!("{}/path", crate::sidecar_url(app)))
        .map_err(|_| "resource_permission_failed")?;
    path_url
        .query_pairs_mut()
        .append_pair("directory", directory);
    let native_paths: serde_json::Value = client
        .get(path_url.as_str())
        .set("Authorization", &crate::sidecar_auth_header(app))
        .call()
        .map_err(|_| "resource_session_unavailable")?
        .into_json()
        .map_err(|_| "resource_session_unavailable")?;
    let read_base = native_paths
        .get("worktree")
        .and_then(serde_json::Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or("resource_session_unavailable")?;
    let current: serde_json::Value = client
        .get(url.as_str())
        .set("Authorization", &crate::sidecar_auth_header(app))
        .call()
        .map_err(|_| "resource_session_unavailable")?
        .into_json()
        .map_err(|_| "resource_session_unavailable")?;
    let mut rules = current
        .get("permission")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    for permission in ["read", "glob", "grep", "list", "external_directory"] {
        // Ask, never globally allow: Rust resolves each requested path against this session's refs.
        let rule = serde_json::json!({"permission":permission,"pattern":"*","action":"ask"});
        rules.retain(|existing| existing != &rule);
        rules.push(rule);
    }
    client
        .patch(url.as_str())
        .set("Authorization", &crate::sidecar_auth_header(app))
        .send_json(serde_json::json!({"permission":rules}))
        .map_err(|_| "resource_permission_failed")?;
    Ok(PathBuf::from(read_base))
}

pub(crate) fn resolve_registered_request(
    app: &tauri::AppHandle,
    request: &PermissionRequest,
) -> bool {
    let Some(store) = app.try_state::<ResourceStore>() else {
        return false;
    };
    let Ok(Some(directory)) = store.session_directory(&request.session_id) else {
        return false;
    };
    let Ok(scopes) = store.scopes(
        &crate::agent::opencode_wire_directory(&directory),
        &request.session_id,
    ) else {
        return false;
    };
    allows_request(&scopes, &directory, request)
}
