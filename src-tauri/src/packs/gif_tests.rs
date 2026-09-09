use serde_json::json;
use std::fs;

#[test]
fn gif_import_validates_before_replacing_existing_pack() {
    // Given: a working legacy installation and a GIF upgrade.
    let root = std::env::temp_dir().join(format!("gif-pack-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("packs/bear")).unwrap();
    let old = br#"{"packId":"bear","version":"old"}"#;
    fs::write(root.join("packs/bear/pack.json"), old).unwrap();
    let mut config = json!({"schemaVersion":1,"canvas":{"width":240,"height":240},
        "animations":{},"feedback":{"successMs":1400,"errorMs":1440},
        "leaving":{"durationMs":910,"translateXRatio":-0.35,"positionEasing":"ease-in-out","opacityEasing":"linear"},
        "thinkingEscalationMs":8000});
    for state in [
        "idle", "thinking", "working", "talking", "success", "error", "leaving",
    ] {
        config["animations"][state] = json!({"file":"animations/idle.gif","scale":1,"offsetY":0});
    }
    let manifest = br#"{"packId":"bear","personas":[{"id":"bear","renderType":"gif"}]}"#;
    // When: missing, disguised and truncated GIF upgrades are imported.
    for gif in [
        None,
        Some(b"not a gif".as_slice()),
        Some(b"GIF89a\xf0\x00\xf0\x00\x00\x00\x00;".as_slice()),
    ] {
        let config_bytes = serde_json::to_vec(&config).unwrap();
        let mut entries = vec![
            ("pack.json", manifest.as_slice()),
            ("personas/bear/persona.md", b"new".as_slice()),
            ("personas/bear/figure2d.json", config_bytes.as_slice()),
        ];
        if let Some(bytes) = gif {
            entries.push(("personas/bear/animations/idle.gif", bytes));
        }
        let archive = root.join("test.dmpack");
        fs::write(&archive, super::tests::archive(&entries)).unwrap();
        let result = super::import_pack_into(&archive, &root.join("packs"));
        // Then: invalid upgrades leave the original manifest untouched.
        assert!(result.is_err());
        assert_eq!(fs::read(root.join("packs/bear/pack.json")).unwrap(), old);
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn gif_extension_is_admitted_only_under_personas() {
    // Given / When / Then: archive and skill paths enforce separate boundaries.
    assert!(super::safe_entry_path("personas/bear/animations/idle.gif").is_some());
    assert!(super::safe_entry_path("skills/bear/idle.gif").is_none());
    assert!(!super::is_safe_filename("idle.gif"));
}

#[test]
fn imports_real_gif_assets_and_rejects_invalid_config_upgrades() {
    let root = std::env::temp_dir().join(format!("gif-real-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/personas/xiaoxiongchong");
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/figure2d-contract.json"
    ))
    .unwrap();
    let original = fixtures[0]["config"].clone();
    let v2 = fixtures[1]["config"].clone();
    let manifest =
        br#"{"packId":"bear","version":"1","personas":[{"id":"bear","renderType":"gif"}]}"#;
    let states = [
        "idle", "thinking", "working", "talking", "success", "error", "leaving",
    ];
    let files: Vec<_> = states
        .iter()
        .map(|state| {
            (
                format!("personas/bear/animations/{state}.gif"),
                fs::read(source.join(format!("animations/{state}.gif"))).unwrap(),
            )
        })
        .collect();
    let mut legacy = original.clone();
    legacy["leaving"]["translateXRatio"] = json!(-0.35);
    let mut configs = vec![legacy.clone(), original.clone(), v2.clone()];
    for (pointer, value) in [
        ("/schemaVersion", json!(3)),
        ("/animations/idle/file", json!("../idle.gif")),
        ("/animations/idle/scale", json!(2)),
        ("/animations/idle/offsetY", json!(241)),
        ("/leaving/translateXRatio", json!(-0.6)),
        ("/feedback/successMs", json!(10001)),
        ("/animations/idle/file", json!("https://evil.test/a.gif")),
    ] {
        let mut config = original.clone();
        *config.pointer_mut(pointer).unwrap() = value;
        configs.push(config);
    }
    let mut missing = original.clone();
    missing["animations"]
        .as_object_mut()
        .unwrap()
        .remove("error");
    configs.push(missing);
    for name in ["polygon-bowtie", "missing-action-offsetX", "unknown-action"] {
        let fixture = fixtures
            .as_array()
            .unwrap()
            .iter()
            .find(|fixture| fixture["name"] == name)
            .unwrap();
        configs.push(fixture["config"].clone());
    }
    for (index, config) in configs.iter().enumerate() {
        let bytes = serde_json::to_vec(config).unwrap();
        let mut entries = vec![
            ("pack.json", manifest.as_slice()),
            ("personas/bear/persona.md", b"original".as_slice()),
            ("personas/bear/figure2d.json", bytes.as_slice()),
        ];
        entries.extend(
            files
                .iter()
                .map(|(name, bytes)| (name.as_str(), bytes.as_slice())),
        );
        let archive = root.join("test.dmpack");
        fs::write(&archive, super::tests::archive(&entries)).unwrap();
        let result = super::import_pack_into(&archive, &root.join("packs"));
        if index < 3 {
            assert!(result.is_ok(), "{result:?}");
        } else {
            assert!(result.is_err(), "invalid config {index}");
        }
        assert_eq!(
            fs::read(root.join("packs/bear/personas/bear/figure2d.json")).unwrap(),
            serde_json::to_vec(if index == 0 {
                &legacy
            } else if index == 1 {
                &original
            } else {
                &v2
            })
            .unwrap()
        );
    }
    for (_, bytes) in &files {
        for end in [6, 13, bytes.len() / 2, bytes.len() - 1] {
            assert!(super::gif::validate(&bytes[..end]).is_err());
        }
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn render_type_defaults_to_glb_and_rejects_unknown_types() {
    let legacy: super::manifest::PackPersona =
        serde_json::from_value(json!({"id":"legacy"})).unwrap();
    assert!(matches!(
        legacy.render_type,
        super::manifest::RenderType::Glb
    ));
    assert!(serde_json::from_value::<super::manifest::PackPersona>(
        json!({"id":"bad","renderType":"video"})
    )
    .is_err());
}

#[test]
#[ignore = "requires explicitly built YUME_GIF_DMPACK artifact"]
fn imports_actual_xiaoxiongchong_artifact() {
    let archive = std::path::PathBuf::from(std::env::var("YUME_GIF_DMPACK").unwrap());
    let root = std::env::temp_dir().join(format!("gif-artifact-{}", uuid::Uuid::new_v4()));
    let imported = super::import_pack_into(&archive, &root).unwrap();
    assert_eq!(imported.pack_id, "xiaoxiongchong");
    assert_eq!(imported.persona_ids, vec!["xiaoxiongchong"]);
    assert!(imported.thumbnail_path.is_some());
    let persona = root.join("xiaoxiongchong/personas/xiaoxiongchong");
    assert!(persona.join("persona.md").is_file());
    assert!(!persona.join("figure.glb").exists());
    for state in [
        "idle", "thinking", "working", "talking", "success", "error", "leaving",
    ] {
        assert!(persona.join(format!("animations/{state}.gif")).is_file());
    }
    assert_eq!(super::installed_packs_in(&root).unwrap().len(), 1);
    super::uninstall_pack_in(&root, "xiaoxiongchong").unwrap();
    assert!(super::installed_packs_in(&root).unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn gif_shared_contract_fixtures() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/figure2d-contract.json"
    ))
    .unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let result =
            super::figure2d::parse_config(&serde_json::to_vec(&fixture["config"]).unwrap());
        assert_eq!(
            result.is_ok(),
            fixture["valid"].as_bool().unwrap(),
            "{}",
            fixture["name"]
        );
    }
}
