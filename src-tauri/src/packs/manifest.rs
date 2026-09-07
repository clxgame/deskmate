use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{is_safe_filename, is_safe_id, ThumbnailPath};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PackName {
    pub zh: String,
    pub en: String,
    pub ja: String,
    pub ko: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PackSkill {
    pub(super) id: String,
    pub(super) file: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PackPersona {
    pub(super) id: String,
    #[serde(default)]
    pub(super) skills: Vec<PackSkill>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PackManifest {
    pub(super) pack_id: String,
    #[serde(default)]
    pub(super) version: String,
    #[serde(default)]
    pub(super) personas: Vec<PackPersona>,
    pub(super) name: Option<PackName>,
    pub(super) thumbnail: Option<ThumbnailPath>,
}

pub(super) fn read_manifest(path: &Path) -> Result<PackManifest, String> {
    if fs::metadata(path).map_err(|error| error.to_string())?.len() > super::MAX_MANIFEST_BYTES {
        return Err("角色包清单过大".into());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let manifest: PackManifest = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("角色包清单无法解析: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PackManifest) -> Result<(), String> {
    if !is_safe_id(&manifest.pack_id) {
        return Err("角色包 id 不合法".into());
    }
    if let Some(name) = &manifest.name {
        for localized in [&name.zh, &name.en, &name.ja, &name.ko] {
            if localized.trim().is_empty()
                || localized.chars().count() > 120
                || localized.chars().any(char::is_control)
            {
                return Err("角色包名称必须为 1 至 120 个可见字符".into());
            }
        }
    }
    if let Some(thumbnail) = &manifest.thumbnail {
        if !manifest
            .personas
            .iter()
            .any(|persona| persona.id == thumbnail.persona_id())
        {
            return Err("角色包缩略图必须属于清单中的角色".into());
        }
    }
    for persona in &manifest.personas {
        if !is_safe_id(&persona.id) {
            return Err(format!("角色 id 不合法: {}", persona.id));
        }
        for skill in &persona.skills {
            // The file name alone is declared; the directory comes from the
            // persona id, so a manifest cannot reach outside its own pack.
            if !is_safe_id(&skill.id) || !is_safe_filename(&skill.file) {
                return Err(format!("技能声明不合法: {}", skill.file));
            }
        }
    }
    Ok(())
}
