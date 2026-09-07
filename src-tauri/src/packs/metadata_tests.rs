use std::fs;

use super::read_manifest;

fn manifest_result(metadata: &str) -> Result<super::PackManifest, String> {
    let root = std::env::temp_dir().join(format!("yume-pack-metadata-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).expect("fixture directory");
    let path = root.join("pack.json");
    fs::write(
        &path,
        format!(r#"{{"packId":"aki","personas":[{{"id":"changli"}}],{metadata}}}"#),
    )
    .expect("manifest fixture");
    let result = read_manifest(&path);
    fs::remove_dir_all(root).expect("cleanup fixture");
    result
}

#[test]
fn rejects_localized_name_when_blank() {
    // Given: a localized title that has no visible content.
    let metadata = r#""name":{"zh":"   ","en":"Aki","ja":"アキ","ko":"아키"}"#;
    // When: the archive manifest is parsed.
    let result = manifest_result(metadata);
    // Then: import cannot accept the blank title.
    assert!(result.is_err(), "blank localized names must be rejected");
}

#[test]
fn rejects_localized_name_when_over_the_limit() {
    // Given: one localized title longer than 120 characters.
    let metadata = format!(
        r#""name":{{"zh":"{}","en":"Aki","ja":"アキ","ko":"아키"}}"#,
        "阿".repeat(121)
    );
    // When: the archive manifest is parsed.
    let result = manifest_result(&metadata);
    // Then: unbounded presentation text is rejected.
    assert!(result.is_err(), "localized names must be bounded");
}

#[test]
fn rejects_thumbnail_when_outside_declared_persona() {
    // Given: a cover that belongs to an undeclared persona.
    let metadata = r#""thumbnail":"personas/someone-else/cover.png""#;
    // When: the archive manifest is parsed.
    let result = manifest_result(metadata);
    // Then: the cover cannot be resolved through another persona.
    assert!(
        result.is_err(),
        "thumbnail must belong to a declared persona"
    );
}

#[test]
fn rejects_thumbnail_when_url_or_unsafe_path() {
    // Given: untrusted paths with URL, absolute, traversal or non-PNG forms.
    for thumbnail in [
        "https://example.com/cover.png",
        "/personas/changli/cover.png",
        "C:/personas/changli/cover.png",
        "personas/changli/../cover.png",
        "personas/changli/./cover.png",
        "skills/changli/cover.png",
        "personas/changli/cover.json",
        "personas/changli/cover.png:stream",
    ] {
        let metadata = format!(r#""thumbnail":"{thumbnail}""#);
        // When: the archive manifest is parsed.
        let result = manifest_result(&metadata);
        // Then: no unsafe presentation path is accepted.
        assert!(result.is_err(), "accepted thumbnail: {thumbnail}");
    }
}
