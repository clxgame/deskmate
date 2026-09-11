use std::path::Path;
use tauri::Manager;

pub(crate) fn persona_gif_envelope(
    app: &tauri::AppHandle,
    persona_id: &str,
) -> Option<crate::pet_geometry::GifEnvelope> {
    let root = app.path().app_data_dir().ok()?.join("packs");
    for pack in super::installed_packs_in(&root).ok()? {
        if pack.persona_ids.iter().any(|id| id == persona_id) {
            let pack_root = root.join(pack.pack_id);
            let manifest = super::manifest::read_manifest(&pack_root.join(super::MANIFEST_NAME)).ok()?;
            let persona = manifest.personas.iter().find(|persona| persona.id == persona_id)?;
            let config_name = match persona.render_type {
                super::manifest::RenderType::Glb => return None,
                super::manifest::RenderType::Gif => "figure2d.json",
                super::manifest::RenderType::Rig2d => "figure-rig2d.json",
            };
            let path = pack_root.join("personas").join(persona_id).join(config_name);
            if std::fs::metadata(&path).ok()?.len() > super::MAX_MANIFEST_BYTES {
                return None;
            }
            let bytes = std::fs::read(path).ok()?;
            return match persona.render_type {
                super::manifest::RenderType::Glb => None,
                super::manifest::RenderType::Gif => super::figure2d::parse_config(&bytes).ok()?.envelope,
                super::manifest::RenderType::Rig2d => {
                    super::rig2d::parse_config(&bytes).ok()?;
                    Some(crate::pet_geometry::GifEnvelope { horizontal: 1.0, top: 1.0, bottom: 0.0 })
                }
            };
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
