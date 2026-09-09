use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

use super::MANIFEST_NAME;

const ALLOWED_EXTENSIONS: &[&str] = &["glb", "json", "md", "png"];
const ALLOWED_ROOTS: &[&str] = &["personas", "skills"];

#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "String")]
pub(super) struct ThumbnailPath {
    relative: PathBuf,
    persona_id: String,
}

impl ThumbnailPath {
    pub(super) fn relative(&self) -> &Path {
        &self.relative
    }

    pub(super) fn persona_id(&self) -> &str {
        &self.persona_id
    }
}

impl TryFrom<String> for ThumbnailPath {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let invalid = || "角色包缩略图必须为角色目录内的相对 PNG 路径".to_string();
        let normalized = value.replace('\\', "/");
        let parts: Vec<_> = normalized.split('/').collect();
        if parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.ends_with(['.', ' '])
                || part.chars().any(char::is_control)
        }) {
            return Err(invalid());
        }
        let ["personas", persona_id, _rest @ ..] = parts.as_slice() else {
            return Err(invalid());
        };
        let relative = safe_entry_path(&normalized).ok_or_else(invalid)?;
        if !relative
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        {
            return Err(invalid());
        }
        Ok(Self {
            relative,
            persona_id: (*persona_id).to_string(),
        })
    }
}
/// Ids become directory names, so each must be one safe path segment. Rejecting
/// everything outside `[A-Za-z0-9_-]` also rules out `.`, separators, and
/// lookalike Unicode.
pub(super) fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(super) fn has_allowed_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .is_some_and(|extension| ALLOWED_EXTENSIONS.contains(&extension.as_str()))
}

/// A skill manifest supplies only a file name; the directory is derived from the
/// persona id, so a manifest can never point at a file outside its own pack.
pub(super) fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('.')
        && has_allowed_extension(Path::new(name))
}

/// Re-derives where an archive entry may be written, relative to the pack root.
///
/// Returns `None` for anything that escapes the pack directory (zip-slip),
/// sits outside the expected layout, or carries an unexpected extension. The
/// caller must use the returned path and never the raw entry name.
pub(super) fn safe_entry_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.len() > 512 {
        return None;
    }
    // Archives may use either separator; treat both as a boundary.
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return None;
    }

    let mut parts: Vec<&str> = Vec::new();
    for component in Path::new(&normalized).components() {
        match component {
            // Only plain names survive: `..`, `.`, roots and prefixes are all
            // rejected rather than normalized away.
            Component::Normal(part) => parts.push(part.to_str()?),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }

    let path: PathBuf = parts.iter().collect();
    let persona_gif = parts.first() == Some(&"personas")
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("gif"));
    if !has_allowed_extension(&path) && !persona_gif {
        return None;
    }

    match parts.as_slice() {
        [MANIFEST_NAME] => Some(path),
        [root, rest @ ..] if ALLOWED_ROOTS.contains(root) && !rest.is_empty() => {
            // `personas/<id>/...` and `skills/<id>/...`: the id is a directory
            // name, so it has to pass the same check as a pack id.
            is_safe_id(rest[0]).then_some(path)
        }
        _ => None,
    }
}
