use super::{anchored_origin, dimensions, pixel_size, GifEnvelope, PetGeometry};
#[test]
fn legacy_sizes_when_scale_changes() {
    let actual = [0.1, 0.5, 1.0, 2.0, 3.0].map(|scale| {
        dimensions(PetGeometry {
            scale,
            gif: false,
            envelope: None,
        })
    });
    assert_eq!(
        actual,
        [
            (160.0, 210.0),
            (160.0, 210.0),
            (320.0, 420.0),
            (640.0, 840.0),
            (640.0, 840.0)
        ]
    );
}
#[test]
fn gif_full_left_travel_fits_when_scale_changes() {
    for scale in [0.1, 0.5, 1.0, 2.0] {
        let (width, _) = dimensions(PetGeometry {
            scale,
            gif: true,
            envelope: None,
        });
        assert!((width - 320.0 * scale) / 2.0 - 160.0 * scale >= 0.0);
    }
}
#[test]
fn envelope_fits_all_contract_boundaries_and_preserves_anchor() {
    for scale in [0.1, 0.5, 1.0, 2.0] {
        let base = PetGeometry {
            scale,
            gif: true,
            envelope: None,
        };
        let expanded = PetGeometry {
            envelope: Some(GifEnvelope {
                horizontal: 3.0,
                top: 3.0,
                bottom: 1.0,
            }),
            ..base
        };
        let (w, h) = dimensions(expanded);
        let frame = 320.0 * scale;
        assert!(w >= 6.0 * frame);
        assert!(h >= 4.0 * frame);
        let (bw, bh) = dimensions(base);
        let origin = (-30.0, 40.0);
        let moved = anchored_origin(origin, (bw / 2.0, bh), (w / 2.0, h - expanded.bottom()));
        assert!((moved.0 + w / 2.0 - origin.0 - bw / 2.0).abs() < 1e-9);
        assert!((moved.1 + h - expanded.bottom() - origin.1 - bh).abs() < 1e-9);
        let restored = anchored_origin(moved, (w / 2.0, h - expanded.bottom()), (bw / 2.0, bh));
        assert!((restored.0 - origin.0).abs() < 1e-9 && (restored.1 - origin.1).abs() < 1e-9);
    }
}
#[test]
fn native_envelope_rejects_unbounded_or_nonfinite_input() {
    for bad in [f64::NAN, f64::INFINITY, -1.0, 4.0] {
        assert!(!GifEnvelope {
            horizontal: bad,
            top: 1.0,
            bottom: 0.0
        }
        .valid());
        assert!(!GifEnvelope {
            horizontal: 1.0,
            top: bad,
            bottom: 0.0
        }
        .valid());
        assert!(!GifEnvelope {
            horizontal: 1.0,
            top: 1.0,
            bottom: bad
        }
        .valid());
    }
}
#[test]
fn fractional_dpi_extent_rounds_outward_and_keeps_anchor() {
    for scale in [0.1, 0.5, 1.0, 2.0] {
        for factor in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let geometry = PetGeometry {
                scale,
                gif: true,
                envelope: Some(GifEnvelope {
                    horizontal: 1.2,
                    top: 1.2,
                    bottom: 19.8165137615 / 240.0,
                }),
            };
            let nominal = dimensions(geometry);
            let physical = pixel_size(nominal, factor);
            assert!(physical.0 >= (nominal.0 * factor).ceil());
            assert!(physical.1 >= (nominal.1 * factor).ceil());
            let rounded = (physical.0 / factor, physical.1 / factor);
            assert_eq!(rounded.0.fract(), 0.0);
            assert_eq!(rounded.1.fract(), 0.0);
            let old = (nominal.0 / 2.0, nominal.1 - geometry.bottom());
            let next = (rounded.0 / 2.0, rounded.1 - geometry.bottom());
            let moved = anchored_origin((40.0, 50.0), old, next);
            assert!(((moved.0 + next.0 - 40.0 - old.0) * factor).abs() < 1.0);
            assert!(((moved.1 + next.1 - 50.0 - old.1) * factor).abs() < 1.0);
        }
    }
    assert_eq!(pixel_size((768.0, 446.4220183487), 1.25), (960.0, 560.0));
    assert_eq!(pixel_size((768.0, 558.0 / 1.25), 1.25), (960.0, 560.0));
    assert_eq!(pixel_size((768.0, 559.0 / 1.25), 1.25), (960.0, 560.0));
}
