use std::path::Path;
use tauri::Manager;

pub(crate) fn persona_gif_envelope(
    app: &tauri::AppHandle,
    persona_id: &str,
) -> Option<crate::pet_geometry::GifEnvelope> {
    let root = app.path().app_data_dir().ok()?.join("packs");
    for pack in super::installed_packs_in(&root).ok()? {
        if pack.persona_ids.iter().any(|id| id == persona_id) {
            let path = root
                .join(pack.pack_id)
                .join("personas")
                .join(persona_id)
                .join("figure2d.json");
            if std::fs::metadata(&path).ok()?.len() > super::MAX_MANIFEST_BYTES {
                return None;
            }
            return super::figure2d::parse_config(&std::fs::read(path).ok()?)
                .ok()?
                .envelope;
        }
    }
    None
}

pub(crate) fn persona_default_position(
    app: &tauri::AppHandle,
    persona_id: &str,
) -> Option<crate::pet_placement::DefaultPosition> {
    let root = app.path().app_data_dir().ok()?.join("packs");
    persona_default_position_in(&root, persona_id)
}

pub(super) fn persona_default_position_in(
    root: &Path,
    persona_id: &str,
) -> Option<crate::pet_placement::DefaultPosition> {
    for pack in super::installed_packs_in(root).ok()? {
        if !pack.persona_ids.iter().any(|id| id == persona_id) {
            continue;
        }
        let manifest =
            super::manifest::read_manifest(&root.join(pack.pack_id).join(super::MANIFEST_NAME))
                .ok()?;
        return manifest
            .personas
            .into_iter()
            .find(|persona| persona.id == persona_id)?
            .default_position;
    }
    None
}
