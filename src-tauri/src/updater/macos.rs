//! macOS releases currently contain DMG/ZIP installers, not Tauri
//! updater archives. Check the release API independently of the Windows-only
//! latest.json, then let the user download the matching installer.
use std::{io::Read, time::Duration};

use semver::Version;
use serde::Deserialize;

use super::{Repository, UpdateError, UpdateOutcome};

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    state: String,
    size: u64,
}

fn release_version(tag: &str) -> Result<Version, UpdateError> {
    let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| UpdateError::InvalidManifest)?;
    if !version.pre.is_empty() {
        return Err(UpdateError::InvalidManifest);
    }
    Ok(version)
}

fn installer_names(version: &Version, arch: &str) -> Result<Vec<String>, UpdateError> {
    let arch = match arch {
        "aarch64" => "aarch64",
        "x86_64" => "x64",
        _ => return Err(UpdateError::PlatformNotAvailable),
    };
    Ok(["dmg", "app.zip"]
        .iter()
        .flat_map(|extension| {
            [arch, "universal"].map(|arch| format!("YUME_{version}_{arch}.{extension}"))
        })
        .collect())
}

pub(super) fn validate_download_url(
    repository: &Repository,
    raw: &str,
    arch: &str,
) -> Result<(), UpdateError> {
    let url = url::Url::parse(raw).map_err(|_| UpdateError::InvalidManifest)?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(UpdateError::InvalidManifest);
    }
    let parts: Vec<_> = url
        .path_segments()
        .ok_or(UpdateError::InvalidManifest)?
        .collect();
    if parts.len() != 6
        || !parts[0].eq_ignore_ascii_case(&repository.owner)
        || !parts[1].eq_ignore_ascii_case(&repository.name)
        || parts[2] != "releases"
        || parts[3] != "download"
    {
        return Err(UpdateError::InvalidManifest);
    }
    let version = release_version(parts[4])?;
    if !installer_names(&version, arch)?
        .iter()
        .any(|name| name == parts[5])
    {
        return Err(UpdateError::InvalidManifest);
    }
    Ok(())
}

fn outcome(
    repository: &Repository,
    release: Release,
    current: &str,
    arch: &str,
) -> Result<UpdateOutcome, UpdateError> {
    if release.draft || release.prerelease {
        return Err(UpdateError::InvalidManifest);
    }
    let version = release_version(&release.tag_name)?;
    let current_version = Version::parse(current).map_err(|_| UpdateError::InvalidManifest)?;
    // Ignore build metadata for precedence; never offer a downgrade.
    if version.cmp_precedence(&current_version).is_le() {
        return Ok(UpdateOutcome::UpToDate {
            current_version: current.to_owned(),
        });
    }
    for name in installer_names(&version, arch)? {
        if let Some(asset) = release
            .assets
            .iter()
            .find(|asset| asset.name == name && asset.state == "uploaded" && asset.size > 0)
        {
            validate_download_url(repository, &asset.browser_download_url, arch)?;
            let expected_suffix = format!("/releases/download/{}/{name}", release.tag_name);
            if !url::Url::parse(&asset.browser_download_url)
                .map_err(|_| UpdateError::InvalidManifest)?
                .path()
                .ends_with(&expected_suffix)
            {
                return Err(UpdateError::InvalidManifest);
            }
            return Ok(UpdateOutcome::Available {
                version: version.to_string(),
                download_url: asset.browser_download_url.clone(),
            });
        }
    }
    Err(UpdateError::PlatformNotAvailable)
}

fn request_error(error: ureq::Error) -> UpdateError {
    match error {
        ureq::Error::Status(404, _) => UpdateError::ManifestNotFound,
        ureq::Error::Status(403 | 429, _) => UpdateError::RateLimited,
        _ => UpdateError::Network,
    }
}

pub(super) fn check(
    repository: &Repository,
    current: &str,
    arch: &str,
) -> Result<UpdateOutcome, UpdateError> {
    let endpoint = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        repository.owner, repository.name
    );
    let response = ureq::AgentBuilder::new()
        .try_proxy_from_env(true)
        .https_only(true)
        .timeout(Duration::from_secs(20))
        .build()
        .get(&endpoint)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", &format!("YUME/{current}"))
        .call()
        .map_err(request_error)?;
    let release = serde_json::from_reader(response.into_reader().take(2 * 1024 * 1024))
        .map_err(|_| UpdateError::InvalidManifest)?;
    outcome(repository, release, current, arch)
}

#[cfg(test)]
mod tests;
