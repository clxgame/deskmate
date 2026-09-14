use super::*;

const SCREEN: Rect = Rect {
    x: 0,
    y: 74,
    width: 3420,
    height: 2052,
};

fn recover(frame: Rect, areas: &[Rect]) -> Rect {
    let origin = Point {
        x: frame.x,
        y: frame.y,
    };
    let point = corrected_origin(origin, frame, areas, false).unwrap_or(origin);
    Rect {
        x: point.x,
        y: point.y,
        ..frame
    }
}

fn contained(frame: Rect, area: Rect) -> bool {
    frame.x >= area.x
        && frame.y >= area.y
        && frame.x + frame.width <= area.x + area.width
        && frame.y + frame.height <= area.y + area.height
}

#[test]
fn restores_reported_retina_position_at_170_percent_scale() {
    let old = Rect {
        x: 3100,
        y: 1662,
        width: 1088,
        height: 1428,
    };
    let fixed = recover(old, &[SCREEN]);
    assert!(contained(fixed, SCREEN));
    assert_eq!((fixed.width, fixed.height), (old.width, old.height));
    assert_eq!(recover(fixed, &[SCREEN]), fixed);
}

#[test]
fn preserves_valid_position_on_negative_coordinate_monitor() {
    let external = Rect {
        x: -3840,
        y: -500,
        width: 3840,
        height: 2160,
    };
    let pet = Rect {
        x: -1400,
        y: 100,
        width: 1088,
        height: 1428,
    };
    assert_eq!(recover(pet, &[SCREEN, external]), pet);
    assert!(contained(recover(pet, &[SCREEN]), SCREEN));
}

#[test]
fn scale_increase_and_smaller_work_area_keep_drawing_reachable() {
    let pet = Rect {
        x: 2750,
        y: 1300,
        width: 640,
        height: 800,
    };
    assert_eq!(recover(pet, &[SCREEN]), pet);
    let larger = Rect {
        width: 1088,
        height: 1428,
        ..pet
    };
    assert!(contained(recover(larger, &[SCREEN]), SCREEN));
    let shorter = Rect {
        height: 1700,
        ..SCREEN
    };
    assert!(contained(recover(pet, &[shorter]), shorter));
}

#[test]
fn empty_space_between_monitors_is_not_a_visible_work_area() {
    let external = Rect {
        x: 5000,
        y: 0,
        width: 2000,
        height: 1800,
    };
    let pet = Rect {
        x: 4000,
        y: 200,
        width: 500,
        height: 600,
    };
    let fixed = recover(pet, &[SCREEN, external]);
    assert!(contained(fixed, SCREEN) || contained(fixed, external));
}

#[test]
fn ignores_transparent_gif_padding_and_preserves_frame_offset_when_recovering() {
    let origin = Point { x: -1000, y: -400 };
    let frame = Rect {
        x: 100,
        y: 100,
        width: 600,
        height: 600,
    };
    assert_eq!(corrected_origin(origin, frame, &[SCREEN], false), None);
    let offscreen = Rect { x: 3300, ..frame };
    let result = corrected_origin(origin, offscreen, &[SCREEN], false).expect("recover");
    assert_eq!(result.x - origin.x, 2820 - offscreen.x);
    assert_eq!(result.y, origin.y);
}

#[test]
fn oversized_pet_is_centered_and_does_not_oscillate() {
    let pet = Rect {
        x: 3000,
        y: 2000,
        width: 4000,
        height: 3000,
    };
    let fixed = recover(pet, &[SCREEN]);
    assert_eq!(fixed.x + fixed.width / 2, SCREEN.x + SCREEN.width / 2);
    assert_eq!(fixed.y + fixed.height / 2, SCREEN.y + SCREEN.height / 2);
    assert_eq!(recover(fixed, &[SCREEN]), fixed);
}

#[test]
fn find_pet_moves_valid_external_position_to_primary_screen() {
    let external = Rect {
        x: -2000,
        y: 0,
        width: 2000,
        height: 1800,
    };
    let pet = Rect {
        x: -1800,
        y: 100,
        width: 600,
        height: 600,
    };
    let result = corrected_origin(Point { x: pet.x, y: pet.y }, pet, &[SCREEN, external], true)
        .expect("find");
    assert!(contained(
        Rect {
            x: result.x,
            y: result.y,
            ..pet
        },
        SCREEN
    ));
}

#[test]
fn transient_missing_monitors_do_not_invent_a_position() {
    let pet = Rect {
        x: 3000,
        y: 2000,
        width: 600,
        height: 600,
    };
    assert_eq!(
        corrected_origin(Point { x: pet.x, y: pet.y }, pet, &[], false),
        None
    );
}

#[test]
fn observer_checks_only_settled_layout_changes_not_ordinary_dragging() {
    let layout = Layout {
        areas: vec![SCREEN],
        frame_size: Size {
            width: 1088,
            height: 1428,
        },
        frame_offset: Point { x: 0, y: 0 },
        factor: 2.0,
    };
    let mut observer = Observation::default();
    assert!(!observer.settled_change(layout.clone()));
    assert!(observer.settled_change(layout.clone()));
    assert!(!observer.settled_change(layout.clone()));
    let changed = Layout {
        factor: 1.0,
        ..layout
    };
    assert!(!observer.settled_change(changed.clone()));
    assert!(observer.settled_change(changed.clone()));
    assert!(!observer.settled_change(changed));
}
