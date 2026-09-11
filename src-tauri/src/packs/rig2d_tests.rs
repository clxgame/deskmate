use serde_json::json;
use std::{fs, path::Path};

fn config() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../public/personas/baobao/figure-rig2d.json")).unwrap()
}

#[test]
fn rejects_padded_config_beyond_runtime_size_limit() {
    let mut bytes = serde_json::to_vec(&config()).unwrap();
    bytes.resize(128 * 1024, b' ');
    assert!(super::rig2d::parse_config(&bytes).is_ok());
    bytes.push(b' ');
    assert!(super::rig2d::parse_config(&bytes).is_err());
}

#[test]
fn shared_rig2d_contract_matches_frontend_and_authoring() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../../tests/fixtures/rig2d-contract.json")).unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let result = super::rig2d::parse_config(&serde_json::to_vec(&fixture["config"]).unwrap());
        assert_eq!(result.is_ok(), fixture["valid"].as_bool().unwrap(), "{}", fixture["name"]);
    }
}

#[test]
fn imports_all_authored_rig2d_assets_and_preserves_previous_pack_on_bad_upgrade() {
    let root = std::env::temp_dir().join(format!("rig2d-valid-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("packs")).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/personas/baobao");
    let mut entries: Vec<(String, Vec<u8>)> = vec![
        ("pack.json".into(), br#"{"packId":"baobao","version":"1.0.0","personas":[{"id":"baobao","renderType":"rig2d"}]}"#.to_vec()),
        ("personas/baobao/persona.md".into(), b"Baobao".to_vec()),
        ("personas/baobao/figure-rig2d.json".into(), fs::read(source.join("figure-rig2d.json")).unwrap()),
    ];
    for entry in fs::read_dir(source.join("assets")).unwrap() {
        let path = entry.unwrap().path();
        entries.push((format!("personas/baobao/assets/{}", path.file_name().unwrap().to_str().unwrap()), fs::read(path).unwrap()));
    }
    let archive = root.join("valid.dmpack");
    let borrowed: Vec<(&str, &[u8])> = entries.iter().map(|(path, bytes)| (path.as_str(), bytes.as_slice())).collect();
    fs::write(&archive, super::tests::archive(&borrowed)).unwrap();
    let installed = super::import_pack_into(&archive, &root.join("packs")).unwrap();
    assert_eq!(installed.persona_ids, ["baobao"]);
    let previous = fs::read(root.join("packs/baobao/pack.json")).unwrap();
    let mut invalid = config();
    invalid["renderer"] = json!("execute-javascript");
    entries[2].1 = serde_json::to_vec(&invalid).unwrap();
    let borrowed: Vec<(&str, &[u8])> = entries.iter().map(|(path, bytes)| (path.as_str(), bytes.as_slice())).collect();
    fs::write(&archive, super::tests::archive(&borrowed)).unwrap();
    assert!(super::import_pack_into(&archive, &root.join("packs")).is_err());
    assert_eq!(fs::read(root.join("packs/baobao/pack.json")).unwrap(), previous);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rig2d_config_accepts_authored_data_and_rejects_unsafe_parameters() {
    let original = config();
    assert!(super::rig2d::parse_config(&serde_json::to_vec(&original).unwrap()).is_ok());
    for (pointer, invalid) in [
        ("/renderer", json!("external-script")),
        ("/states/sleep/textures/0", json!("../outside.png")),
        ("/states/sleep/rig/eyeRadius/0", json!(0)),
        ("/states/sleep/alignment/blink/0/2", json!(513)),
        ("/states/sleep/hitPolygon", json!([[0,0],[100,100],[0,100],[100,0]])),
    ] {
        let mut input = original.clone();
        *input.pointer_mut(pointer).unwrap() = invalid;
        assert!(super::rig2d::parse_config(&serde_json::to_vec(&input).unwrap()).is_err(), "{pointer}");
    }
}

#[test]
fn rig2d_png_checks_crc_and_full_decode() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/personas/baobao/assets/sleep-0.png");
    let bytes = fs::read(source).unwrap();
    assert!(super::rig2d::validate_png(&bytes).is_ok());
    assert!(super::rig2d::validate_png(&bytes[..bytes.len() - 12]).is_err());
    let mut corrupted = bytes;
    let index = corrupted.len() - 5;
    corrupted[index] ^= 1;
    assert!(super::rig2d::validate_png(&corrupted).is_err());
}

#[test]
fn rig2d_import_rejects_missing_and_corrupt_textures_without_replacing_old_pack() {
    let root = std::env::temp_dir().join(format!("rig2d-import-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("packs/baobao")).unwrap();
    let old = br#"{"packId":"baobao","version":"old"}"#;
    fs::write(root.join("packs/baobao/pack.json"), old).unwrap();
    let config = serde_json::to_vec(&config()).unwrap();
    for texture in [None, Some(b"not a png".as_slice())] {
        let mut entries = vec![
            ("pack.json", br#"{"packId":"baobao","personas":[{"id":"baobao","renderType":"rig2d"}]}"#.as_slice()),
            ("personas/baobao/persona.md", b"new prompt".as_slice()),
            ("personas/baobao/figure-rig2d.json", config.as_slice()),
        ];
        if let Some(bytes) = texture { entries.push(("personas/baobao/assets/idle-0.png", bytes)); }
        let archive = root.join("invalid.dmpack");
        fs::write(&archive, super::tests::archive(&entries)).unwrap();
        assert!(super::import_pack_into(&archive, &root.join("packs")).is_err());
        assert_eq!(fs::read(root.join("packs/baobao/pack.json")).unwrap(), old);
    }
    fs::remove_dir_all(root).unwrap();
}
