use std::fs;

#[test]
fn rejects_corrupt_lzw_upgrade_before_replacing_valid_install() {
    let root = std::env::temp_dir().join(format!("gif-lzw-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../public/personas/xiaoxiongchong/figure2d.json");
    let mut config: serde_json::Value = serde_json::from_slice(&fs::read(source).unwrap()).unwrap();
    for animation in config["animations"].as_object_mut().unwrap().values_mut() {
        animation["file"] = serde_json::json!("idle.gif");
    }
    let config = serde_json::to_vec(&config).unwrap();
    let manifest = br#"{"packId":"bear","personas":[{"id":"bear","renderType":"gif"}]}"#;
    let mut gif = b"GIF89a\xf0\x00\xf0\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00\x3b".to_vec();
    for corrupt in [false, true] {
        if corrupt {
            gif[31] = 0xff;
            gif[32] = 0xff;
        }
        let entries = [
            ("pack.json", manifest.as_slice()),
            ("personas/bear/persona.md", b"prompt".as_slice()),
            ("personas/bear/figure2d.json", config.as_slice()),
            ("personas/bear/idle.gif", gif.as_slice()),
        ];
        let archive = root.join("test.dmpack");
        fs::write(&archive, super::tests::archive(&entries)).unwrap();
        let result = super::import_pack_into(&archive, &root.join("packs"));
        if corrupt {
            assert!(result.is_err(), "corrupt LZW upgrade must fail");
        } else {
            assert!(result.is_ok(), "{result:?}");
        }
        let installed = fs::read(root.join("packs/bear/personas/bear/idle.gif")).unwrap();
        assert_eq!(&installed[31..33], &[0x44, 0x01]);
    }
    fs::remove_dir_all(root).unwrap();
}

fn code_stream(codes: &[(u16, u8)]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut bit = 0usize;
    for &(code, width) in codes {
        for shift in 0..width {
            if bit / 8 == bytes.len() {
                bytes.push(0);
            }
            if (code >> shift) & 1 != 0 {
                bytes[bit / 8] |= 1 << (bit % 8);
            }
            bit += 1;
        }
    }
    bytes
}

#[test]
fn validates_lzw_growth_special_next_code_and_clear_reset() {
    let growth = code_stream(&[(4, 3), (0, 3), (1, 3), (6, 3), (8, 4), (5, 4)]);
    assert!(super::gif_lzw::validate(&growth, 2, 7, 2, None).is_ok());
    let reset = code_stream(&[(4, 3), (0, 3), (1, 3), (6, 3), (4, 4), (0, 3), (5, 3)]);
    assert!(super::gif_lzw::validate(&reset, 2, 5, 2, None).is_ok());
}

#[test]
fn rejects_lzw_invalid_references_palette_count_and_missing_end() {
    for (codes, pixels, palette) in [
        (vec![(4, 3), (7, 3), (5, 3)], 1, 2),
        (vec![(4, 3), (2, 3), (5, 3)], 1, 2),
        (vec![(4, 3), (0, 3), (5, 3)], 2, 2),
        (vec![(4, 3), (0, 3), (0, 3), (5, 3)], 1, 2),
        (vec![(4, 3), (0, 3)], 1, 2),
        (vec![(0, 3), (5, 3)], 1, 2),
    ] {
        assert!(super::gif_lzw::validate(&code_stream(&codes), 2, pixels, palette, None).is_err());
    }
}

#[test]
fn rejects_catalog_gif_renderer_bypass_and_preserves_installation() {
    let root = std::env::temp_dir().join(format!("gif-renderer-{}", uuid::Uuid::new_v4()));
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/personas/xiaoxiongchong");
    let config = fs::read(source.join("figure2d.json")).unwrap();
    let states = [
        "idle", "thinking", "working", "talking", "success", "error", "leaving",
    ];
    let files: Vec<_> = states
        .iter()
        .map(|state| {
            (
                format!("personas/xiaoxiongchong/animations/{state}.gif"),
                fs::read(source.join(format!("animations/{state}.gif"))).unwrap(),
            )
        })
        .collect();
    fs::create_dir_all(&root).unwrap();
    for renderer in [Some("gif"), None, Some("glb")] {
        let mut manifest =
            serde_json::json!({"packId":"xiaoxiongchong","personas":[{"id":"xiaoxiongchong"}]});
        if let Some(renderer) = renderer {
            manifest["personas"][0]["renderType"] = serde_json::json!(renderer);
        }
        let manifest = serde_json::to_vec(&manifest).unwrap();
        let mut entries = vec![
            ("pack.json", manifest.as_slice()),
            ("personas/xiaoxiongchong/persona.md", b"prompt".as_slice()),
        ];
        if renderer == Some("gif") {
            entries.push(("personas/xiaoxiongchong/figure2d.json", config.as_slice()));
            entries.extend(
                files
                    .iter()
                    .map(|(name, bytes)| (name.as_str(), bytes.as_slice())),
            );
        }
        let archive = root.join("test.dmpack");
        fs::write(&archive, super::tests::archive(&entries)).unwrap();
        let result = super::import_pack_into(&archive, &root.join("packs"));
        assert_eq!(result.is_ok(), renderer == Some("gif"), "{result:?}");
        assert_eq!(
            fs::read(root.join("packs/xiaoxiongchong/personas/xiaoxiongchong/figure2d.json"))
                .unwrap(),
            config
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn accepts_transparent_index_beyond_local_palette() {
    let data = code_stream(&[(4, 3), (3, 3), (5, 3)]);
    assert!(super::gif_lzw::validate(&data, 2, 1, 2, Some(3)).is_ok());
    assert!(super::gif_lzw::validate(&data, 2, 1, 2, None).is_err());
}
