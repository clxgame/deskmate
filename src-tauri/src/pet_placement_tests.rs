use super::*;
use crate::window_layout::Rect;

fn position() -> DefaultPosition {
    serde_json::from_str(include_str!(
        "../../public/personas/xiaoxiongchong/placement.json"
    ))
    .expect("position")
}

#[test]
fn reproduces_the_captured_visual_position_including_transparent_overflow() {
    let point = position().resolve(
        Rect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1390,
        },
        PhysicalPosition::new(240.0, 163.48623853211006),
    );
    assert!((point.x - 2208.0).abs() < 0.001);
    assert!((point.y - 1166.0).abs() < 0.001);
}

#[test]
fn drawing_anchor_stays_relative_across_monitors_and_dpi() {
    for area in [
        Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        },
        Rect {
            x: -1440,
            y: -412,
            width: 1440,
            height: 2510,
        },
        Rect {
            x: 2560,
            y: 0,
            width: 2560,
            height: 1390,
        },
    ] {
        for dpi in [1.0, 1.25, 1.5, 2.0] {
            let anchor = PhysicalPosition::new(192.0 * dpi, 130.78899082568805 * dpi);
            let point = position().resolve(area, anchor);
            assert!(
                (point.x + anchor.x - area.x as f64 - area.width as f64 * 0.95625).abs() < 0.001
            );
            assert!(
                (point.y + anchor.y - area.y as f64 - area.height as f64 * 0.9564649198072734)
                    .abs()
                    < 0.001
            );
        }
    }
}

#[test]
fn rejects_invalid_ratio_types_ranges_and_anchor_modes() {
    for json in [
        r#"{"anchor":"drawing-center","x":-0.1,"y":0.5}"#,
        r#"{"anchor":"drawing-center","x":0.5,"y":1.1}"#,
        r#"{"anchor":"drawing-center","x":"0.5","y":0.5}"#,
        r#"{"anchor":"window","x":0.5,"y":0.5}"#,
        r#"{"anchor":"drawing-center","x":0.5}"#,
        r#"{"anchor":"drawing-center","x":0.5,"y":0.5,"extra":0}"#,
    ] {
        assert!(
            serde_json::from_str::<DefaultPosition>(json).is_err(),
            "{json}"
        );
    }
}
