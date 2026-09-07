use super::{is_safe_filename, is_safe_id, safe_entry_path};
use sha2::Digest;
use std::path::Path;

#[test]
fn skill_file_names_stay_inside_their_own_directory() {
    assert!(is_safe_filename("ncmdump.md"));
    assert!(is_safe_filename("notes.json"));

    // The directory is derived from the persona id, so a manifest must not be
    // able to supply any path of its own.
    assert!(!is_safe_filename("../../etc/passwd.md"));
    assert!(!is_safe_filename("skills/xiaozhu/ncmdump.md"));
    assert!(!is_safe_filename("a\\b.md"));
    assert!(!is_safe_filename("C:evil.md"));
    assert!(!is_safe_filename(".hidden.md"));
    // Only asset and text formats, never anything executable.
    assert!(!is_safe_filename("run.exe"));
    assert!(!is_safe_filename("hack.ps1"));
    assert!(!is_safe_filename("noext"));
    assert!(!is_safe_filename(""));
}

#[test]
fn ids_must_be_a_single_safe_path_segment() {
    assert!(is_safe_id("aki"));
    assert!(is_safe_id("ai-substitute"));
    assert!(is_safe_id("zhujue_FM"));

    // Anything that could escape a directory or traverse it is refused.
    assert!(!is_safe_id(""));
    assert!(!is_safe_id("."));
    assert!(!is_safe_id(".."));
    assert!(!is_safe_id("a/b"));
    assert!(!is_safe_id("a\\b"));
    assert!(!is_safe_id("a.b"));
    assert!(!is_safe_id("C:"));
    assert!(!is_safe_id(&"x".repeat(65)));
}

#[test]
fn accepts_only_the_documented_layout() {
    assert_eq!(
        safe_entry_path("pack.json"),
        Some(Path::new("pack.json").into())
    );
    assert_eq!(
        safe_entry_path("personas/changli/figure.glb"),
        Some(Path::new("personas/changli/figure.glb").into()),
    );
    assert_eq!(
        safe_entry_path("skills/xiaozhu/ncmdump.md"),
        Some(Path::new("skills/xiaozhu/ncmdump.md").into()),
    );
    // Windows-style separators appear in archives built on Windows.
    assert!(safe_entry_path("personas\\changli\\persona.md").is_some());
    // `Path::components` drops interior `.` segments, so the rebuilt path is
    // already normalized and still lands inside the persona directory.
    assert_eq!(
        safe_entry_path("personas/./changli/persona.md"),
        Some(Path::new("personas/changli/persona.md").into()),
    );
}

#[test]
fn rejects_zip_slip_and_absolute_paths() {
    assert!(safe_entry_path("../evil.json").is_none());
    assert!(safe_entry_path("personas/../../evil.json").is_none());
    // A single `..` is enough to leave the pack directory.
    assert!(safe_entry_path("personas/../evil.json").is_none());
    assert!(safe_entry_path("/etc/passwd.md").is_none());
    assert!(safe_entry_path("C:/Windows/system.json").is_none());
    assert!(safe_entry_path("\\\\server\\share\\a.json").is_none());
}

#[test]
fn rejects_unexpected_locations_and_formats() {
    // Only pack.json may sit at the root.
    assert!(safe_entry_path("README.md").is_none());
    assert!(safe_entry_path("other/changli/persona.md").is_none());
    // A persona id that is not a safe segment cannot become a directory.
    assert!(safe_entry_path("personas/../figure.glb").is_none());
    // Executables and scripts must never be unpacked.
    assert!(safe_entry_path("personas/changli/run.exe").is_none());
    assert!(safe_entry_path("skills/xiaozhu/hack.ps1").is_none());
    assert!(safe_entry_path("personas/changli/figure").is_none());
}

#[test]
fn requires_a_persona_id_below_each_root() {
    // `personas/<id>/<file>` is the layout, so a file sitting directly under
    // a root has no persona to belong to and is refused.
    assert!(safe_entry_path("personas/loose.json").is_none());
    assert!(safe_entry_path("skills/loose.md").is_none());
    // A bare root directory carries no file at all.
    assert!(safe_entry_path("personas").is_none());
    assert!(safe_entry_path("skills").is_none());
}

/// Builds an archive in memory from `(entryName, contents)` pairs.
pub(super) fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
        for (name, contents) in entries {
            writer.start_file(*name, options).expect("start entry");
            std::io::Write::write_all(&mut writer, contents).expect("write entry");
        }
        writer.finish().expect("finish archive");
    }
    buffer.into_inner()
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("yume-packs-{name}"));
    let _ = super::fs::remove_dir_all(&dir);
    super::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

#[test]
fn extracts_a_well_formed_archive_and_reports_its_digest() {
    let manifest = br#"{"packId":"aki","version":"1.0.0","personas":[{"id":"changli"}]}"#;
    let bytes = archive(&[
        ("pack.json", manifest.as_slice()),
        ("personas/changli/persona.md", b"hello".as_slice()),
    ]);

    let root = scratch("ok");
    let archive_path = root.join("pack.dmpack");
    super::fs::write(&archive_path, &bytes).expect("write archive");
    let staging = root.join("staging");
    super::fs::create_dir_all(&staging).expect("staging");

    let digest = super::extract_verified(&archive_path, &staging).expect("extract");

    // The digest must be of the archive itself, so a user can confirm which
    // build they installed.
    assert_eq!(digest, format!("{:x}", super::Sha256::digest(&bytes)));
    assert!(staging.join("pack.json").is_file());
    assert!(staging.join("personas/changli/persona.md").is_file());

    let parsed = super::read_manifest(&staging.join("pack.json")).expect("manifest");
    assert_eq!(parsed.pack_id, "aki");

    let _ = super::fs::remove_dir_all(&root);
}

#[test]
fn refuses_an_archive_that_tries_to_escape_the_pack_directory() {
    // A zip-slip archive must be rejected outright rather than sanitized,
    // and nothing may be written outside the staging directory.
    let bytes = archive(&[
        ("pack.json", br#"{"packId":"aki"}"#.as_slice()),
        ("../escaped.md", b"pwned".as_slice()),
    ]);

    let root = scratch("slip");
    let archive_path = root.join("evil.dmpack");
    super::fs::write(&archive_path, &bytes).expect("write archive");
    let staging = root.join("staging");
    super::fs::create_dir_all(&staging).expect("staging");

    let error =
        super::extract_verified(&archive_path, &staging).expect_err("zip-slip must be refused");
    assert!(error.contains("不安全的路径"), "{error}");
    assert!(!root.join("escaped.md").exists());

    let _ = super::fs::remove_dir_all(&root);
}

#[test]
fn refuses_an_archive_without_a_manifest() {
    let bytes = archive(&[("personas/changli/persona.md", b"hi".as_slice())]);

    let root = scratch("nomanifest");
    let archive_path = root.join("pack.dmpack");
    super::fs::write(&archive_path, &bytes).expect("write archive");
    let staging = root.join("staging");
    super::fs::create_dir_all(&staging).expect("staging");

    let error = super::extract_verified(&archive_path, &staging)
        .expect_err("a pack without pack.json is unusable");
    assert!(error.contains("pack.json"), "{error}");

    let _ = super::fs::remove_dir_all(&root);
}

#[test]
fn refuses_a_manifest_declaring_an_unsafe_skill_path() {
    let manifest = br#"{"packId":"aki","personas":[{"id":"changli",
        "skills":[{"id":"changli","file":"../../evil.md"}]}]}"#;
    let root = scratch("badskill");
    let path = root.join("pack.json");
    super::fs::write(&path, manifest).expect("write manifest");

    let error = super::read_manifest(&path).expect_err("unsafe skill must be refused");
    assert!(error.contains("技能声明不合法"), "{error}");

    let _ = super::fs::remove_dir_all(&root);
}

#[test]
fn refuses_a_manifest_with_an_unsafe_pack_id() {
    let root = scratch("badpack");
    let path = root.join("pack.json");
    super::fs::write(&path, br#"{"packId":"../etc"}"#).expect("write manifest");

    let error = super::read_manifest(&path).expect_err("unsafe pack id must be refused");
    assert!(error.contains("角色包 id 不合法"), "{error}");

    let _ = super::fs::remove_dir_all(&root);
}

/// Exercises the import path against an archive produced by
/// `scripts/pack-personas.ts` rather than a hand-built fixture, so the
/// packaging script and the importer are known to agree on the layout.
#[test]
#[ignore = "requires an explicit YUME_TEST_DMPACK built by the packaging script"]
fn imports_a_real_dmpack_built_by_the_packaging_script() {
    let archive = std::path::PathBuf::from(
        std::env::var("YUME_TEST_DMPACK")
            .expect("set YUME_TEST_DMPACK to the archive produced by the packaging script"),
    );

    let root = scratch("realpack");
    let staging = root.join("staging");
    super::fs::create_dir_all(&staging).expect("staging");

    let digest = super::extract_verified(&archive, &staging).expect("real pack extracts");
    assert_eq!(digest.len(), 64);

    let manifest = super::read_manifest(&staging.join("pack.json")).expect("manifest");
    assert_eq!(manifest.pack_id, "aki");
    assert!(manifest.personas.iter().any(|p| p.id == "changli"));

    // Directory entries and nested textures must both survive extraction.
    assert!(staging.join("personas/changli/figure.glb").is_file());
    assert!(staging
        .join("personas/changli/textures/Hair/baseColor.png")
        .is_file());
    // A declared skill file has to land where persona_grants_skill looks.
    assert!(staging.join("skills/xiaozhu/ncmdump.md").is_file());

    let _ = super::fs::remove_dir_all(&root);
}
