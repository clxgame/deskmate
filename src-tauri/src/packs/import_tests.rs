use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use sha2::{Digest, Sha256};

use super::{import_pack_into, installed_packs_in};

const PNG: &[u8] = include_bytes!("../../icons/32x32.png");
const COVER: &str = "personas/changli/cover.png";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("yume-pack-import-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("fixture directory");
        Self(path)
    }

    fn packs(&self) -> PathBuf {
        self.0.join("packs")
    }

    fn archive(&self, metadata: serde_json::Value, cover: Option<&[u8]>) -> PathBuf {
        let bytes = serde_json::to_vec(&metadata).expect("manifest bytes");
        let mut entries = vec![
            ("pack.json", bytes.as_slice()),
            ("personas/changli/persona.md", b"persona prompt".as_slice()),
        ];
        if let Some(cover) = cover {
            entries.push((COVER, cover));
        }
        let archive = self.0.join(format!("{}.dmpack", uuid::Uuid::new_v4()));
        fs::write(&archive, super::tests::archive(&entries)).expect("fixture archive");
        archive
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn metadata() -> serde_json::Value {
    json!({"packId":"aki", "version":"1.0.1", "personas":[{"id":"changli"}],
        "name":{"zh":"阿绮角色包", "en":"Aki Pack", "ja":"アキパック", "ko":"아키 팩"},
        "thumbnail": COVER})
}

#[test]
fn imports_metadata_when_archive_supplies_title_and_png() {
    // Given: an archive carrying localized package metadata.
    let fixture = Fixture::new();
    let source = fixture.archive(metadata(), Some(PNG));
    // When: the archive is imported through the native file boundary.
    let imported = import_pack_into(&source, &fixture.packs()).expect("import metadata");
    // Then: the receipt contains the archive metadata and a usable installed path.
    let receipt = serde_json::to_value(&imported).expect("serialize receipt");
    assert_eq!(receipt["name"], metadata()["name"]);
    assert_eq!(receipt["version"], "1.0.1");
    assert_eq!(receipt["personaIds"], json!(["changli"]));
    assert_eq!(
        receipt["sha256"],
        format!("{:x}", Sha256::digest(fs::read(source).expect("archive")))
    );
    let thumbnail = Path::new(receipt["thumbnailPath"].as_str().expect("thumbnail path"));
    assert!(thumbnail.is_absolute());
    assert_eq!(fs::read(thumbnail).expect("installed PNG"), PNG);
    assert!(thumbnail.ends_with(Path::new("aki").join(COVER)));
}

#[test]
fn lists_metadata_when_reloading_an_installed_pack() {
    // Given: a successfully imported package.
    let fixture = Fixture::new();
    let source = fixture.archive(metadata(), Some(PNG));
    let imported = import_pack_into(&source, &fixture.packs()).expect("import fixture");
    // When: the installed directory is read independently.
    let listed = installed_packs_in(&fixture.packs()).expect("list installed");
    // Then: display metadata survives without any catalog lookup.
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, imported.name);
    assert_eq!(listed[0].thumbnail_path, imported.thumbnail_path);
}

#[test]
fn omits_metadata_when_importing_an_id_only_legacy_pack() {
    // Given: a legacy manifest with only its required identity.
    let fixture = Fixture::new();
    let source = fixture.archive(json!({"packId":"aki"}), None);
    // When: the legacy archive is imported and listed.
    let imported = import_pack_into(&source, &fixture.packs()).expect("legacy import");
    let listed = installed_packs_in(&fixture.packs()).expect("legacy listing");
    // Then: old fields retain their defaults and optional fields stay absent.
    for serialized in [
        serde_json::to_value(imported).expect("receipt"),
        serde_json::to_value(&listed[0]).expect("listing"),
    ] {
        assert_eq!(serialized["packId"], "aki");
        assert_eq!(serialized["version"], "");
        assert_eq!(serialized["personaIds"], json!([]));
        assert!(serialized.get("name").is_none());
        assert!(serialized.get("thumbnailPath").is_none());
    }
}

#[test]
fn rejects_import_when_declared_png_is_missing_or_invalid() {
    // Given: a cover declaration with absent, disguised or truncated content.
    for cover in [
        None,
        Some(b"not a PNG".as_slice()),
        Some(&PNG[..24]),
        Some(&PNG[..33]),
    ] {
        let fixture = Fixture::new();
        let source = fixture.archive(metadata(), cover);
        // When: native import attempts to validate staging.
        let result = import_pack_into(&source, &fixture.packs());
        // Then: the invalid cover prevents installation.
        assert!(result.is_err());
        assert!(!fixture.packs().join("aki").exists());
    }
}

#[test]
fn rejects_import_when_png_exceeds_cover_size_limit() {
    // Given: a PNG larger than the four MiB cover budget.
    let fixture = Fixture::new();
    let mut cover = PNG.to_vec();
    cover.resize(4 * 1024 * 1024 + 1, 0);
    let source = fixture.archive(metadata(), Some(&cover));
    // When: staging validates the declared cover.
    let result = import_pack_into(&source, &fixture.packs());
    // Then: the import is rejected before a pack is installed.
    assert!(result.is_err());
}

#[test]
fn retains_previous_pack_when_upgrade_cover_is_invalid() {
    // Given: an installed pack and an upgrade with an invalid PNG.
    let fixture = Fixture::new();
    let original = fixture.archive(metadata(), Some(PNG));
    let installed = import_pack_into(&original, &fixture.packs()).expect("initial import");
    let mut upgrade = metadata();
    upgrade["version"] = json!("1.0.2");
    let source = fixture.archive(upgrade, Some(b"bad upgrade cover"));
    // When: the invalid upgrade is submitted.
    let result = import_pack_into(&source, &fixture.packs());
    // Then: the prior package remains installed with its original metadata and assets.
    assert!(result.is_err());
    let listed = installed_packs_in(&fixture.packs()).expect("list prior install");
    assert_eq!(listed[0].version, "1.0.1");
    assert_eq!(listed[0].name, installed.name);
    assert_eq!(
        fs::read(fixture.packs().join("aki").join(COVER)).expect("prior cover"),
        PNG
    );
    assert_eq!(
        fs::read_to_string(fixture.packs().join("aki/personas/changli/persona.md"))
            .expect("prior prompt"),
        "persona prompt"
    );
}
