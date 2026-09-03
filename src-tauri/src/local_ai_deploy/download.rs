use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::{CcSwitchPackage, LocalAiDeploymentError};

const DOWNLOAD_SLACK_BYTES: u64 = 1;

pub(super) fn ensure_cc_switch_package(
    cache_directory: &Path,
    package: CcSwitchPackage,
) -> Result<PathBuf, LocalAiDeploymentError> {
    fs::create_dir_all(cache_directory)
        .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_cache_failed"))?;
    if !plain_directory(cache_directory) {
        return Err(LocalAiDeploymentError::new(
            "local_ai_ccswitch_cache_failed",
        ));
    }
    let destination = cache_directory.join(package.filename);
    if package_matches(&destination, package) {
        return Ok(destination);
    }
    let _ = fs::remove_file(&destination);
    for url in [package.url, package.fallback_url] {
        if download_once(url, &destination, package).is_ok() {
            return Ok(destination);
        }
    }
    Err(LocalAiDeploymentError::new(
        "local_ai_ccswitch_download_failed",
    ))
}

fn download_once(
    url: &str,
    destination: &Path,
    package: CcSwitchPackage,
) -> Result<(), LocalAiDeploymentError> {
    let partial = destination.with_extension(format!("{}.partial", uuid::Uuid::new_v4()));
    let result = (|| {
        let response = ureq::get(url)
            .timeout(Duration::from_secs(90))
            .call()
            .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_download_failed"))?;
        let mut input = response
            .into_reader()
            .take(package.size + DOWNLOAD_SLACK_BYTES);
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&partial)
            .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_cache_failed"))?;
        let mut hasher = Sha256::new();
        let mut copied = 0_u64;
        let mut buffer = [0_u8; 32 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_download_failed"))?;
            if count == 0 {
                break;
            }
            copied += count as u64;
            if copied > package.size {
                return Err(LocalAiDeploymentError::new(
                    "local_ai_ccswitch_package_invalid",
                ));
            }
            hasher.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_cache_failed"))?;
        }
        output
            .sync_all()
            .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_cache_failed"))?;
        let digest = format!("{:x}", hasher.finalize());
        if digest != package.sha256 {
            return Err(LocalAiDeploymentError::new(
                "local_ai_ccswitch_package_invalid",
            ));
        }
        fs::rename(&partial, destination)
            .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_cache_failed"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn package_matches(path: &Path, package: CcSwitchPackage) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata_is_link(&metadata) || metadata.len() != package.size {
        return false;
    }
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    if std::io::copy(&mut file, &mut hasher).is_err() {
        return false;
    }
    format!("{:x}", hasher.finalize()) == package.sha256
}

fn plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata_is_link(&metadata))
}

fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}
