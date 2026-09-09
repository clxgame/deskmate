use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use super::manifest::read_manifest;
use super::paths::{has_allowed_extension, is_safe_filename, is_safe_id};
use super::{installed_packs, MANIFEST_NAME};
pub(crate) fn persona_uses_gif(app: &tauri::AppHandle, persona_id: &str) -> bool {
    if !is_safe_id(persona_id) {
        return false;
    }
    let Ok(data_dir) = app.path().app_data_dir() else {
        return false;
    };
    for pack in installed_packs(app.clone()).unwrap_or_default() {
        if !pack.persona_ids.iter().any(|id| id == persona_id) {
            continue;
        }
        if let Ok(manifest) = read_manifest(
            &data_dir
                .join("packs")
                .join(pack.pack_id)
                .join(MANIFEST_NAME),
        ) {
            if let Some(persona) = manifest
                .personas
                .iter()
                .find(|persona| persona.id == persona_id)
            {
                return match persona.render_type {
                    super::manifest::RenderType::Glb => false,
                    super::manifest::RenderType::Gif => true,
                };
            }
        }
    }
    false
}

/// Reads a persona's prompt files, preferring an installed pack and falling back
/// to the personas shipped in the app data dir.
pub fn persona_files(
    app: &tauri::AppHandle,
    persona_id: &str,
) -> Result<(String, Option<String>, Vec<String>), String> {
    if !is_safe_id(persona_id) {
        return Err("invalid persona id".into());
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    // Installed packs win, so an imported persona overrides a stale copy.
    for pack in installed_packs(app.clone()).unwrap_or_default() {
        if !pack.persona_ids.iter().any(|id| id == persona_id) {
            continue;
        }
        let pack_root = data_dir.join("packs").join(&pack.pack_id);
        let persona_dir = pack_root.join("personas").join(persona_id);
        if let Ok(prompt) = fs::read_to_string(persona_dir.join("persona.md")) {
            let placeholders = fs::read_to_string(persona_dir.join("placeholders.json")).ok();
            let skills = pack_skill_texts(&pack_root, persona_id);
            return Ok((prompt, placeholders, skills));
        }
    }

    let persona_dir = data_dir.join("personas").join(persona_id);
    let prompt =
        fs::read_to_string(persona_dir.join("persona.md")).map_err(|error| error.to_string())?;
    let placeholders = fs::read_to_string(persona_dir.join("placeholders.json")).ok();
    let skills = builtin_skill_texts(&data_dir, persona_id);
    Ok((prompt, placeholders, skills))
}

/// Skill bodies declared by a pack's manifest for one persona. The path is built
/// from the persona id plus the declared file name, never from the manifest
/// alone, so a pack cannot read outside `skills/<personaId>/`.
fn pack_skill_texts(pack_root: &Path, persona_id: &str) -> Vec<String> {
    let Ok(manifest) = read_manifest(&pack_root.join(MANIFEST_NAME)) else {
        return Vec::new();
    };
    let Some(persona) = manifest.personas.iter().find(|p| p.id == persona_id) else {
        return Vec::new();
    };
    persona
        .skills
        .iter()
        .filter(|skill| is_safe_filename(&skill.file))
        .filter_map(|skill| {
            let path = pack_root.join("skills").join(&skill.id).join(&skill.file);
            fs::read_to_string(path).ok()
        })
        .collect()
}

/// Skills for personas shipped with the app, read from `skills/<id>/`.
fn builtin_skill_texts(data_dir: &Path, persona_id: &str) -> Vec<String> {
    let dir = data_dir.join("skills").join(persona_id);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| has_allowed_extension(path))
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|path| fs::read_to_string(path).ok())
        .collect()
}

/// Whether a persona is granted a specific skill file.
///
/// Capabilities are declared by the owning pack rather than hardcoded, so a new
/// pack can grant an ability without changing the command that guards it.
pub fn persona_grants_skill(app: &tauri::AppHandle, persona_id: &str, skill_file: &str) -> bool {
    if !is_safe_id(persona_id) || !is_safe_filename(skill_file) {
        return false;
    }
    let Ok(data_dir) = app.path().app_data_dir() else {
        return false;
    };

    for pack in installed_packs(app.clone()).unwrap_or_default() {
        if !pack.persona_ids.iter().any(|id| id == persona_id) {
            continue;
        }
        let pack_root = data_dir.join("packs").join(&pack.pack_id);
        if let Ok(manifest) = read_manifest(&pack_root.join(MANIFEST_NAME)) {
            let declared = manifest
                .personas
                .iter()
                .filter(|persona| persona.id == persona_id)
                .flat_map(|persona| persona.skills.iter())
                .any(|skill| skill.file == skill_file);
            // The file must also exist, so a declaration alone is not enough.
            if declared
                && pack_root
                    .join("skills")
                    .join(persona_id)
                    .join(skill_file)
                    .is_file()
            {
                return true;
            }
        }
    }

    // Personas shipped with the app carry their skills in the app data dir.
    data_dir
        .join("skills")
        .join(persona_id)
        .join(skill_file)
        .is_file()
}
