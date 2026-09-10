use super::position::persona_default_position_in;

#[test]
fn envelope_is_available_before_the_webview_loads_the_gif() {
    let figure = super::figure2d::parse_config(include_bytes!(
        "../../../public/personas/xiaoxiongchong/figure2d.json"
    ))
    .expect("valid figure");
    let envelope = figure.envelope.expect("v2 drawing envelope");
    assert!((envelope.horizontal - 1.199617737003058).abs() < 0.000001);
    assert!((envelope.top - 1.128440366972477).abs() < 0.000001);
    assert!((envelope.bottom - 0.08256880733944971).abs() < 0.000001);
}
use serde_json::json;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("yume-position-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        Self(root)
    }
    fn import(
        &self,
        position: Option<serde_json::Value>,
        version: &str,
    ) -> Result<super::ImportedPack, String> {
        let mut manifest = json!({"packId":"aki","version":version,"personas":[{"id":"changli"}]});
        if let Some(position) = position {
            manifest["personas"][0]["defaultPosition"] = position;
        }
        let bytes = serde_json::to_vec(&manifest).expect("manifest");
        let archive = super::tests::archive(&[
            ("pack.json", &bytes),
            ("personas/changli/persona.md", b"test prompt"),
        ]);
        let source = self.0.join("test.dmpack");
        fs::write(&source, archive).expect("archive");
        super::import_pack_into(&source, &self.0.join("packs"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn default_position_survives_real_import_and_upgrade() {
    let fixture = Fixture::new();
    let root = fixture.0.join("packs");
    fixture.import(None, "1.0.0").expect("legacy import");
    assert!(persona_default_position_in(&root, "changli").is_none());
    fixture
        .import(
            Some(json!({"anchor":"drawing-center","x":0.2,"y":0.8})),
            "1.1.0",
        )
        .expect("upgrade");
    let position = persona_default_position_in(&root, "changli").expect("installed default");
    let point = position.resolve(
        crate::window_layout::Rect {
            x: 0,
            y: 0,
            width: 1000,
            height: 1000,
        },
        tauri::PhysicalPosition::new(0.0, 0.0),
    );
    assert_eq!(point, tauri::PhysicalPosition::new(200.0, 800.0));
    assert!(persona_default_position_in(&root, "xiaozhu").is_none());
}

#[test]
fn invalid_default_position_upgrade_preserves_installed_pack() {
    let fixture = Fixture::new();
    fixture.import(None, "1.0.0").expect("legacy import");
    let target = fixture.0.join("packs/aki/pack.json");
    let original = fs::read(&target).expect("original");
    for value in [
        json!({"anchor":"drawing-center","x":2,"y":0.5}),
        json!({"anchor":"drawing-center","x":"0.5","y":0.5}),
        json!({"anchor":"wrong","x":0.5,"y":0.5}),
    ] {
        assert!(fixture.import(Some(value), "1.1.0").is_err());
        assert_eq!(fs::read(&target).expect("preserved"), original);
    }
}
