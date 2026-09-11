//! User-installable persona packs, validated in staging before installation.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{Emitter, Manager};

mod archive;
mod figure2d;
mod rig2d;
mod gif;
mod installation;
mod manifest;
mod paths;
mod position;
pub(crate) use position::{persona_default_position, persona_gif_envelope};
mod runtime;
mod thumbnail;

pub(crate) use installation::{import_pack_into, installed_packs_in, uninstall_pack_in};
pub use manifest::PackName;
pub(crate) use runtime::persona_uses_gif;
pub use runtime::{persona_files, persona_grants_skill};

#[cfg(test)]
use archive::extract_verified;
#[cfg(test)]
use manifest::{read_manifest, PackManifest};
#[cfg(test)]
use paths::{is_safe_filename, is_safe_id, safe_entry_path};
#[cfg(test)]
use sha2::Sha256;

const MANIFEST_NAME: &str = "pack.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
/// What the frontend needs to render install state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
    pub pack_id: String,
    pub version: String,
    pub persona_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<PackName>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
}

/// Result of a successful import; the digest lets a user confirm which build of
/// a pack they installed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPack {
    pub pack_id: String,
    pub version: String,
    pub persona_ids: Vec<String>,
    pub sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<PackName>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
}

fn packs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("packs");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// Packs currently installed on disk, newest layout only. A directory without a
/// readable manifest is skipped rather than failing the whole listing, so one
/// broken pack cannot hide the others.
#[tauri::command]
pub fn installed_packs(app: tauri::AppHandle) -> Result<Vec<InstalledPack>, String> {
    installed_packs_in(&packs_dir(&app)?)
}

/// Imports a `.dmpack` from a local path.
///
/// The archive is unpacked into a staging directory first, so a failure part way
/// through cannot leave a half-written pack in place of a working one.
#[tauri::command]
pub fn import_pack(app: tauri::AppHandle, path: String) -> Result<ImportedPack, String> {
    let imported = import_pack_into(Path::new(&path), &packs_dir(&app)?)?;
    if let Err(error) = app.emit("deskmate://pack-imported", &imported) {
        eprintln!("pack import notification failed: {error}");
    }
    Ok(imported)
}

/// Removes an installed pack. Built-in packs live inside the app bundle, not
/// here, so they can never be reached by this command.
#[tauri::command]
pub fn uninstall_pack(app: tauri::AppHandle, pack_id: String) -> Result<(), String> {
    uninstall_pack_in(&packs_dir(&app)?, &pack_id)
}

#[cfg(test)]
mod gif_tests;
#[cfg(test)]
mod rig2d_tests;
#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod metadata_tests;
#[cfg(test)]
mod position_tests;
#[cfg(test)]
mod qa_tests;
#[cfg(test)]
mod tests;

mod gif_lzw;
#[cfg(test)]
mod gif_lzw_tests;
