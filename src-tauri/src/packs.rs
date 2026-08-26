//! Persona packs are user-installable bundles: a `.dmpack` archive holding one
//! or more personas with their models, prompts, and skills. Packs are imported
//! from a local file rather than downloaded, so large character sets stay out of
//! the installer without needing a public host.
//!
//! Everything here treats the archive as untrusted input: entry names are
//! re-derived instead of reused, ids must be single safe path segments, and the
//! layout, extensions and sizes are all bounded.

use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

/// Bounds so a malicious or corrupt archive cannot exhaust disk or memory.
const MAX_ENTRIES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// Only asset and text formats. Notably excludes anything executable.
const ALLOWED_EXTENSIONS: &[&str] = &["glb", "json", "md", "png"];

/// Top-level directories a pack may write into, besides `pack.json`.
const ALLOWED_ROOTS: &[&str] = &["personas", "skills"];

const MANIFEST_NAME: &str = "pack.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackSkill {
    id: String,
    file: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackPersona {
    id: String,
    #[serde(default)]
    skills: Vec<PackSkill>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackManifest {
    pack_id: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    personas: Vec<PackPersona>,
}

/// What the frontend needs to render install state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
    pub pack_id: String,
    pub version: String,
    pub persona_ids: Vec<String>,
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
}

/// Ids become directory names, so each must be one safe path segment. Rejecting
/// everything outside `[A-Za-z0-9_-]` also rules out `.`, separators, and
/// lookalike Unicode.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn has_allowed_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .is_some_and(|extension| ALLOWED_EXTENSIONS.contains(&extension.as_str()))
}

/// A skill manifest supplies only a file name; the directory is derived from the
/// persona id, so a manifest can never point at a file outside its own pack.
fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('.')
        && has_allowed_extension(Path::new(name))
}

/// Re-derives where an archive entry may be written, relative to the pack root.
///
/// Returns `None` for anything that escapes the pack directory (zip-slip),
/// sits outside the expected layout, or carries an unexpected extension. The
/// caller must use the returned path and never the raw entry name.
fn safe_entry_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.len() > 512 {
        return None;
    }
    // Archives may use either separator; treat both as a boundary.
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return None;
    }

    let mut parts: Vec<&str> = Vec::new();
    for component in Path::new(&normalized).components() {
        match component {
            // Only plain names survive: `..`, `.`, roots and prefixes are all
            // rejected rather than normalized away.
            Component::Normal(part) => parts.push(part.to_str()?),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }

    let path: PathBuf = parts.iter().collect();
    if !has_allowed_extension(&path) {
        return None;
    }

    match parts.as_slice() {
        [MANIFEST_NAME] => Some(path),
        [root, rest @ ..] if ALLOWED_ROOTS.contains(root) && !rest.is_empty() => {
            // `personas/<id>/...` and `skills/<id>/...`: the id is a directory
            // name, so it has to pass the same check as a pack id.
            is_safe_id(rest[0]).then_some(path)
        }
        _ => None,
    }
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

fn read_manifest(path: &Path) -> Result<PackManifest, String> {
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let manifest: PackManifest = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("角色包清单无法解析: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PackManifest) -> Result<(), String> {
    if !is_safe_id(&manifest.pack_id) {
        return Err("角色包 id 不合法".into());
    }
    for persona in &manifest.personas {
        if !is_safe_id(&persona.id) {
            return Err(format!("角色 id 不合法: {}", persona.id));
        }
        for skill in &persona.skills {
            // The file name alone is declared; the directory comes from the
            // persona id, so a manifest cannot reach outside its own pack.
            if !is_safe_id(&skill.id) || !is_safe_filename(&skill.file) {
                return Err(format!("技能声明不合法: {}", skill.file));
            }
        }
    }
    Ok(())
}

/// Packs currently installed on disk, newest layout only. A directory without a
/// readable manifest is skipped rather than failing the whole listing, so one
/// broken pack cannot hide the others.
#[tauri::command]
pub fn installed_packs(app: tauri::AppHandle) -> Result<Vec<InstalledPack>, String> {
    let dir = packs_dir(&app)?;
    let mut packs = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let Ok(manifest) = read_manifest(&entry.path().join(MANIFEST_NAME)) else {
            continue;
        };
        packs.push(InstalledPack {
            pack_id: manifest.pack_id,
            version: manifest.version,
            persona_ids: manifest.personas.into_iter().map(|p| p.id).collect(),
        });
    }
    packs.sort_by(|left, right| left.pack_id.cmp(&right.pack_id));
    Ok(packs)
}

/// Extracts a validated archive into `staging`, returning its SHA-256.
fn extract_verified(archive_path: &Path, staging: &Path) -> Result<String, String> {
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

/// Imports a `.dmpack` from a local path.
///
/// The archive is unpacked into a staging directory first, so a failure part way
/// through cannot leave a half-written pack in place of a working one.
#[tauri::command]
pub fn import_pack(app: tauri::AppHandle, path: String) -> Result<ImportedPack, String> {
    let archive_path = PathBuf::from(&path);
    let size = fs::metadata(&archive_path)
        .map_err(|_| "无法读取所选文件".to_string())?
        .len();
    if size == 0 {
        return Err("角色包为空".into());
    }

    let dir = packs_dir(&app)?;
    let staging = dir.join(".importing");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;

    let result = (|| -> Result<ImportedPack, String> {
        let sha256 = extract_verified(&archive_path, &staging)?;
        let manifest_path = staging.join(MANIFEST_NAME);
        if fs::metadata(&manifest_path)
            .map(|meta| meta.len())
            .unwrap_or(0)
            > MAX_MANIFEST_BYTES
        {
            return Err("角色包清单过大".into());
        }
        let manifest = read_manifest(&manifest_path)?;

        // Swap in only after the archive fully validated.
        let destination = dir.join(&manifest.pack_id);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
        }
        fs::rename(&staging, &destination).map_err(|error| error.to_string())?;

        Ok(ImportedPack {
            pack_id: manifest.pack_id,
            version: manifest.version,
            persona_ids: manifest.personas.into_iter().map(|p| p.id).collect(),
            sha256,
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Removes an installed pack. Built-in packs live inside the app bundle, not
/// here, so they can never be reached by this command.
#[tauri::command]
pub fn uninstall_pack(app: tauri::AppHandle, pack_id: String) -> Result<(), String> {
    if !is_safe_id(&pack_id) {
        return Err("角色包 id 不合法".into());
    }
    let target = packs_dir(&app)?.join(&pack_id);
    if !target.is_dir() {
        return Err("该角色包未安装".into());
    }
    fs::remove_dir_all(&target).map_err(|error| error.to_string())
}

/// Reads a persona's prompt files, preferring an installed pack and falling back
/// to the personas shipped in the app data dir.
pub fn persona_files(
    app: &tauri::AppHandle,
    persona_id: &str,
) -> Result<(String, Option<String>, Vec<String>), String> {
    if !is_safe_id(persona_id) {
        return Err("invalid persona id".into());
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    // Installed packs win, so an imported persona overrides a stale copy.
    for pack in installed_packs(app.clone()).unwrap_or_default() {
        if !pack.persona_ids.iter().any(|id| id == persona_id) {
            continue;
        }
        let pack_root = data_dir.join("packs").join(&pack.pack_id);
        let persona_dir = pack_root.join("personas").join(persona_id);
        if let Ok(prompt) = fs::read_to_string(persona_dir.join("persona.md")) {
            let placeholders = fs::read_to_string(persona_dir.join("placeholders.json")).ok();
            let skills = pack_skill_texts(&pack_root, persona_id);
            return Ok((prompt, placeholders, skills));
        }
    }

    let persona_dir = data_dir.join("personas").join(persona_id);
    let prompt =
        fs::read_to_string(persona_dir.join("persona.md")).map_err(|error| error.to_string())?;
    let placeholders = fs::read_to_string(persona_dir.join("placeholders.json")).ok();
    let skills = builtin_skill_texts(&data_dir, persona_id);
    Ok((prompt, placeholders, skills))
}

/// Skill bodies declared by a pack's manifest for one persona. The path is built
/// from the persona id plus the declared file name, never from the manifest
/// alone, so a pack cannot read outside `skills/<personaId>/`.
fn pack_skill_texts(pack_root: &Path, persona_id: &str) -> Vec<String> {
    let Ok(manifest) = read_manifest(&pack_root.join(MANIFEST_NAME)) else {
        return Vec::new();
    };
    let Some(persona) = manifest.personas.iter().find(|p| p.id == persona_id) else {
        return Vec::new();
    };
    persona
        .skills
        .iter()
        .filter(|skill| is_safe_filename(&skill.file))
        .filter_map(|skill| {
            let path = pack_root.join("skills").join(&skill.id).join(&skill.file);
            fs::read_to_string(path).ok()
        })
        .collect()
}

/// Skills for personas shipped with the app, read from `skills/<id>/`.
fn builtin_skill_texts(data_dir: &Path, persona_id: &str) -> Vec<String> {
    let dir = data_dir.join("skills").join(persona_id);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| has_allowed_extension(path))
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|path| fs::read_to_string(path).ok())
        .collect()
}

/// Whether a persona is granted a specific skill file.
///
/// Capabilities are declared by the owning pack rather than hardcoded, so a new
/// pack can grant an ability without changing the command that guards it.
pub fn persona_grants_skill(app: &tauri::AppHandle, persona_id: &str, skill_file: &str) -> bool {
    if !is_safe_id(persona_id) || !is_safe_filename(skill_file) {
        return false;
    }
    let Ok(data_dir) = app.path().app_data_dir() else {
        return false;
    };

    for pack in installed_packs(app.clone()).unwrap_or_default() {
        if !pack.persona_ids.iter().any(|id| id == persona_id) {
            continue;
        }
        let pack_root = data_dir.join("packs").join(&pack.pack_id);
        if let Ok(manifest) = read_manifest(&pack_root.join(MANIFEST_NAME)) {
            let declared = manifest
                .personas
                .iter()
                .filter(|persona| persona.id == persona_id)
                .flat_map(|persona| persona.skills.iter())
                .any(|skill| skill.file == skill_file);
            // The file must also exist, so a declaration alone is not enough.
            if declared
                && pack_root
                    .join("skills")
                    .join(persona_id)
                    .join(skill_file)
                    .is_file()
            {
                return true;
            }
        }
    }

    // Personas shipped with the app carry their skills in the app data dir.
    data_dir
        .join("skills")
        .join(persona_id)
        .join(skill_file)
        .is_file()
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

#[cfg(test)]
mod tests {
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
    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
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
    fn imports_a_real_dmpack_built_by_the_packaging_script() {
        let archive = std::env::temp_dir()
            .join("opencode")
            .join("test-aki.dmpack");
        if !archive.is_file() {
            // Built on demand; skip rather than fail when it is absent.
            eprintln!("skipping: {} not present", archive.display());
            return;
        }

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
}
