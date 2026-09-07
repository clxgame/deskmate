use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

use super::paths::safe_entry_path;
use super::MANIFEST_NAME;

const MAX_ENTRIES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Extracts a validated archive into `staging`, returning its SHA-256.
pub(super) fn extract_verified(archive_path: &Path, staging: &Path) -> Result<String, String> {
    let bytes = fs::read(archive_path).map_err(|error| error.to_string())?;
    let digest = format!("{:x}", Sha256::digest(&bytes));

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes))
        .map_err(|error| format!("角色包无法读取: {error}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err("角色包包含的文件过多".into());
    }

    let mut total: u64 = 0;
    let mut wrote_manifest = false;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("角色包条目无法读取: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(relative) = safe_entry_path(entry.name()) else {
            return Err(format!("角色包含有不安全的路径: {}", entry.name()));
        };
        if entry.size() > MAX_FILE_BYTES {
            return Err(format!("角色包中的文件过大: {}", relative.display()));
        }
        total = total.saturating_add(entry.size());
        if total > MAX_TOTAL_BYTES {
            return Err("角色包解压后体积超出上限".into());
        }

        let target = staging.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut out = File::create(&target).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|error| error.to_string())?;
        if relative == Path::new(MANIFEST_NAME) {
            wrote_manifest = true;
        }
    }

    if !wrote_manifest {
        return Err("角色包缺少 pack.json".into());
    }
    Ok(digest)
}

/// Streams a file's SHA-256 without holding it all in memory.
#[allow(dead_code)]
pub fn file_digest(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
