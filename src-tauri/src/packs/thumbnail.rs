use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use super::paths::ThumbnailPath;

const MAX_THUMBNAIL_BYTES: u64 = 4 * 1024 * 1024;
const MAX_THUMBNAIL_DIMENSION: u32 = 8192;
const MAX_THUMBNAIL_PIXELS: u64 = 16 * 1024 * 1024;

pub(super) fn absolute_thumbnail_path(
    root: &Path,
    thumbnail: &ThumbnailPath,
) -> Result<String, String> {
    std::path::absolute(root.join(thumbnail.relative()))
        .map_err(|error| error.to_string())?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "角色包缩略图路径无法编码".to_string())
}

pub(super) fn validate_thumbnail(root: &Path, thumbnail: &ThumbnailPath) -> Result<(), String> {
    let pack_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = fs::canonicalize(root.join(thumbnail.relative()))
        .map_err(|error| format!("角色包缩略图不存在或无法读取: {error}"))?;
    if !path.starts_with(&pack_root) {
        return Err("角色包缩略图不能位于角色包目录之外".into());
    }
    let mut file = File::open(path).map_err(|error| format!("角色包缩略图无法读取: {error}"))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_THUMBNAIL_BYTES {
        return Err("角色包缩略图必须为不超过 4 MiB 的 PNG 文件".into());
    }
    if metadata.len() < 57 {
        return Err("角色包缩略图不是完整的 PNG 图片".into());
    }
    let mut header = [0_u8; 33];
    file.read_exact(&mut header)
        .map_err(|_| "角色包缩略图不是完整的 PNG 图片".to_string())?;
    if &header[..8] != b"\x89PNG\r\n\x1a\n"
        || header[8..12] != 13_u32.to_be_bytes()
        || &header[12..16] != b"IHDR"
    {
        return Err("角色包缩略图不是 PNG 图片".into());
    }
    let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
    let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
    if width == 0
        || height == 0
        || width > MAX_THUMBNAIL_DIMENSION
        || height > MAX_THUMBNAIL_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_THUMBNAIL_PIXELS
    {
        return Err("角色包缩略图尺寸超出上限".into());
    }
    let valid_depth = match header[25] {
        0 => matches!(header[24], 1 | 2 | 4 | 8 | 16),
        2 | 4 | 6 => matches!(header[24], 8 | 16),
        3 => matches!(header[24], 1 | 2 | 4 | 8),
        _ => false,
    };
    if !valid_depth || header[26] != 0 || header[27] != 0 || header[28] > 1 {
        return Err("角色包缩略图 PNG 头不合法".into());
    }
    Ok(())
}
