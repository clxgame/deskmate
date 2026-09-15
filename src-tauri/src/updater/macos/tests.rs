use super::*;

fn repo() -> Repository {
    Repository::parse("clxgame/deskmate").unwrap()
}

fn release(tag: &str, names: &[&str]) -> Release {
    Release {
        tag_name: tag.into(),
        draft: false,
        prerelease: false,
        assets: names
            .iter()
            .map(|name| Asset {
                name: (*name).into(),
                size: 100,
                state: "uploaded".into(),
                browser_download_url: format!(
                    "https://github.com/clxgame/deskmate/releases/download/{tag}/{name}"
                ),
            })
            .collect(),
    }
}

#[test]
fn offers_mac_dmg_without_windows_updater_manifest() {
    let result = outcome(
        &repo(),
        release(
            "v0.3.20",
            &[
                "latest.json",
                "YUME_0.3.20_x64-setup.exe",
                "YUME_0.3.20_aarch64.app.zip",
                "YUME_0.3.20_aarch64.dmg",
            ],
        ),
        "0.3.16",
        "aarch64",
    )
    .unwrap();
    let json = serde_json::to_value(result).unwrap();
    assert_eq!(json["status"], "available");
    assert_eq!(json["version"], "0.3.20");
    assert_eq!(
        json["downloadUrl"],
        "https://github.com/clxgame/deskmate/releases/download/v0.3.20/YUME_0.3.20_aarch64.dmg"
    );
}

#[test]
fn compares_versions_numerically_and_never_downgrades() {
    for (tag, current) in [
        ("v0.3.20", "0.3.20"),
        ("0.3.9", "0.3.20"),
        ("v0.3.20+new", "0.3.20+old"),
    ] {
        assert!(matches!(
            outcome(&repo(), release(tag, &[]), current, "aarch64"),
            Ok(UpdateOutcome::UpToDate { .. })
        ));
    }
    assert!(matches!(
        outcome(
            &repo(),
            release("0.3.20", &["YUME_0.3.20_aarch64.dmg"]),
            "0.3.9",
            "aarch64"
        ),
        Ok(UpdateOutcome::Available { .. })
    ));
}

#[test]
fn falls_back_to_zip_or_universal_installer() {
    for (arch, name) in [
        ("aarch64", "YUME_0.3.20_aarch64.app.zip"),
        ("x86_64", "YUME_0.3.20_x64.dmg"),
        ("x86_64", "YUME_0.3.20_universal.dmg"),
    ] {
        assert!(matches!(
            outcome(&repo(), release("v0.3.20", &[name]), "0.3.16", arch),
            Ok(UpdateOutcome::Available { .. })
        ));
    }
}

#[test]
fn missing_or_wrong_architecture_installer_is_not_up_to_date() {
    for names in [
        vec!["latest.json", "YUME_0.3.20_x64-setup.exe"],
        vec!["YUME_0.3.20_x64.dmg"],
        vec![],
    ] {
        assert!(matches!(
            outcome(&repo(), release("v0.3.20", &names), "0.3.16", "aarch64"),
            Err(UpdateError::PlatformNotAvailable)
        ));
    }
}

#[test]
fn incomplete_uploads_are_not_offered() {
    for (state, size) in [("starter", 100), ("uploaded", 0)] {
        let mut data = release("v0.3.20", &["YUME_0.3.20_aarch64.dmg"]);
        data.assets[0].state = state.into();
        data.assets[0].size = size;
        assert!(matches!(
            outcome(&repo(), data, "0.3.16", "aarch64"),
            Err(UpdateError::PlatformNotAvailable)
        ));
    }
}

#[test]
fn rejects_invalid_or_unpublished_releases() {
    for (tag, draft, prerelease) in [
        ("nightly", false, false),
        ("v0.3.21-beta.1", false, false),
        ("v0.3.21", true, false),
        ("v0.3.21", false, true),
    ] {
        let mut data = release(tag, &[]);
        data.draft = draft;
        data.prerelease = prerelease;
        assert!(matches!(
            outcome(&repo(), data, "0.3.20", "aarch64"),
            Err(UpdateError::InvalidManifest)
        ));
    }
}

#[test]
fn rejects_download_redirects_to_other_repos_protocols_or_assets() {
    let valid =
        "https://github.com/clxgame/deskmate/releases/download/v0.3.20/YUME_0.3.20_aarch64.dmg";
    assert!(validate_download_url(&repo(), valid, "aarch64").is_ok());
    for invalid in [
        valid.replace("https:", "http:"),
        valid.replace("github.com", "evil.example"),
        valid.replace("clxgame/deskmate", "other/deskmate"),
        format!("{valid}?redirect=1"),
        valid.replace("github.com", "user@github.com"),
        valid.replace(".dmg", ".exe"),
        valid.replace("/v0.3.20/", "/v0.3.19/"),
    ] {
        assert!(
            validate_download_url(&repo(), &invalid, "aarch64").is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn rejects_asset_url_pointing_at_another_version() {
    let mut data = release("v0.3.20", &["YUME_0.3.20_aarch64.dmg"]);
    data.assets[0].browser_download_url = data.assets[0]
        .browser_download_url
        .replace("0.3.20", "0.3.19");
    assert!(matches!(
        outcome(&repo(), data, "0.3.16", "aarch64"),
        Err(UpdateError::InvalidManifest)
    ));
}

#[test]
fn distinguishes_http_errors() {
    for (status, expected) in [
        (404, UpdateError::ManifestNotFound),
        (403, UpdateError::RateLimited),
        (429, UpdateError::RateLimited),
        (504, UpdateError::Network),
    ] {
        let response = ureq::Response::new(status, "test", "{}").unwrap();
        assert_eq!(
            request_error(ureq::Error::Status(status, response)),
            expected
        );
    }
}

#[test]
fn supports_github_repository_case_normalization() {
    let repository = Repository::parse("CLXGAME/DeskMate").unwrap();
    assert!(matches!(
        outcome(
            &repository,
            release("v0.3.20", &["YUME_0.3.20_aarch64.dmg"]),
            "0.3.16",
            "aarch64"
        ),
        Ok(UpdateOutcome::Available { .. })
    ));
}

#[test]
#[ignore = "Requires network access to the public GitHub release API"]
fn live_public_mac_release_check() {
    let update = check(&repo(), "0.0.0", "aarch64").expect("public release check failed");
    assert!(matches!(update, UpdateOutcome::Available { .. }));
}
