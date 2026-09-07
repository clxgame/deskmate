use std::fs;
use std::path::{Path, PathBuf};

use super::archive::extract_verified;
use super::manifest::read_manifest;
use super::paths::is_safe_id;
use super::thumbnail::{absolute_thumbnail_path, validate_thumbnail};
use super::{ImportedPack, InstalledPack, MANIFEST_NAME};

struct Staging(PathBuf);

impl Staging {
    fn create(dir: &Path) -> Result<Self, String> {
        let path = dir.join(format!(".importing-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        Ok(Self(path))
    }

    fn install(&self, destination: &Path) -> Result<(), String> {
        let backup = self
            .0
            .with_file_name(format!(".backup-{}", uuid::Uuid::new_v4()));
        let previous = destination.exists();
        if previous {
            fs::rename(destination, &backup).map_err(|error| error.to_string())?;
        }
        if let Err(error) = fs::rename(&self.0, destination) {
            if previous {
                fs::rename(&backup, destination).map_err(|restore| {
                    format!("角色包安装失败: {error}; 原版本恢复失败: {restore}")
                })?;
            }
            return Err(error.to_string());
        }
        if previous {
            let _ = fs::remove_dir_all(backup);
        }
        Ok(())
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn import_pack_into(archive_path: &Path, dir: &Path) -> Result<ImportedPack, String> {
    let size = fs::metadata(archive_path)
        .map_err(|_| "无法读取所选文件".to_string())?
        .len();
    if size == 0 {
        return Err("角色包为空".into());
    }
    let staging = Staging::create(dir)?;
    let sha256 = extract_verified(archive_path, &staging.0)?;
    let manifest = read_manifest(&staging.0.join(MANIFEST_NAME))?;
    let destination = dir.join(&manifest.pack_id);
    let thumbnail_path = manifest
        .thumbnail
        .as_ref()
        .map(|thumbnail| {
            validate_thumbnail(&staging.0, thumbnail)?;
            absolute_thumbnail_path(&destination, thumbnail)
        })
        .transpose()?;
    staging.install(&destination)?;
    Ok(ImportedPack {
        pack_id: manifest.pack_id,
        version: manifest.version,
        persona_ids: manifest
            .personas
            .into_iter()
            .map(|persona| persona.id)
            .collect(),
        sha256,
        name: manifest.name,
        thumbnail_path,
    })
}

pub(crate) fn installed_packs_in(dir: &Path) -> Result<Vec<InstalledPack>, String> {
    let mut packs = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let root = entry.path();
        let Ok(manifest) = read_manifest(&root.join(MANIFEST_NAME)) else {
            continue;
        };
        if entry.file_name() != manifest.pack_id.as_str() {
            continue;
        }
        let thumbnail_path = manifest.thumbnail.as_ref().and_then(|thumbnail| {
            validate_thumbnail(&root, thumbnail).ok()?;
            absolute_thumbnail_path(&root, thumbnail).ok()
        });
        packs.push(InstalledPack {
            pack_id: manifest.pack_id,
            version: manifest.version,
            persona_ids: manifest
                .personas
                .into_iter()
                .map(|persona| persona.id)
                .collect(),
            name: manifest.name,
            thumbnail_path,
        });
    }
    packs.sort_by(|left, right| left.pack_id.cmp(&right.pack_id));
    Ok(packs)
}

pub(crate) fn uninstall_pack_in(dir: &Path, pack_id: &str) -> Result<(), String> {
    if !is_safe_id(pack_id) {
        return Err("角色包 id 不合法".into());
    }
    let target = dir.join(pack_id);
    if !target.is_dir() {
        return Err("该角色包未安装".into());
    }
    fs::remove_dir_all(target).map_err(|error| error.to_string())
}
