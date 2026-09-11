use super::*;
use std::cell::{Cell, RefCell};

struct Window<'a> {
    state: &'a PetGeometryState,
    expected: Cell<PetGeometry>,
    position: Cell<tauri::PhysicalPosition<i32>>,
    size: Cell<tauri::PhysicalSize<u32>>,
    factor: f64,
    fail: Option<&'static str>,
    calls: RefCell<Vec<&'static str>>,
}
impl<'a> Window<'a> {
    fn new(state: &'a PetGeometryState) -> Self {
        Self {
            state,
            expected: Cell::new(*state.0.lock().unwrap()),
            position: Cell::new(tauri::PhysicalPosition::new(40, 50)),
            size: Cell::new(tauri::PhysicalSize::new(200, 263)),
            factor: 1.25,
            fail: None,
            calls: RefCell::new(Vec::new()),
        }
    }
    fn callback(&self, stage: &'static str) -> bool {
        let geometry = self
            .state
            .0
            .try_lock()
            .expect("native callback must never hold geometry mutex");
        if stage == "resize" || stage == "reposition" {
            assert_eq!(
                *geometry,
                self.expected.get(),
                "callbacks must read published target geometry"
            );
        }
        self.calls.borrow_mut().push(stage);
        self.fail != Some(stage)
    }
    fn foot(&self) -> (f64, f64) {
        let geometry = *self.state.0.lock().unwrap();
        (
            f64::from(self.position.get().x) + f64::from(self.size.get().width) / 2.0,
            f64::from(self.position.get().y) + f64::from(self.size.get().height)
                - geometry.bottom() * self.factor,
        )
    }
}
impl NativeGeometry for Window<'_> {
    fn position(&self) -> Option<tauri::PhysicalPosition<i32>> {
        self.callback("position").then(|| self.position.get())
    }
    fn size(&self) -> Option<tauri::PhysicalSize<u32>> {
        self.callback("size").then(|| self.size.get())
    }
    fn factor(&self) -> Option<f64> {
        self.callback("factor").then_some(self.factor)
    }
    fn resize(&self, size: tauri::Size) -> bool {
        if !self.callback("resize") {
            return false;
        }
        self.size.set(size.to_physical(self.factor));
        true
    }
    fn reposition(&self, position: tauri::LogicalPosition<f64>) -> bool {
        if !self.callback("reposition") {
            return false;
        }
        self.position.set(position.to_physical(self.factor));
        true
    }
}
fn envelope(horizontal: f64, bottom: f64) -> GifEnvelope {
    GifEnvelope {
        horizontal,
        top: 1.2,
        bottom,
    }
}
fn gif(scale: f64) -> PetGeometry {
    PetGeometry {
        scale,
        gif: true,
        envelope: Some(envelope(1.2, 0.08)),
    }
}
#[test]
fn geometry_callbacks_see_target_and_preserve_physical_foot() {
    for scale in [0.1, 0.5, 2.0] {
        let state = PetGeometryState::default();
        let window = Window::new(&state);
        let before = window.foot();
        let target = gif(scale);
        window.expected.set(target);
        apply_native(&state, &window, |_| target);
        let after = window.foot();
        assert!((after.0 - before.0).abs() <= 0.5);
        assert!((after.1 - before.1).abs() <= 0.5);
        assert_eq!(
            *window.calls.borrow(),
            ["position", "size", "factor", "resize", "reposition"]
        );
        assert_eq!(*state.0.lock().unwrap(), target);
    }
}
#[test]
fn getter_failures_and_invalid_dpi_do_not_mutate_geometry_or_window() {
    for fail in [Some("position"), Some("size"), Some("factor"), None] {
        for factor in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::MAX, 1.25] {
            if fail.is_none() && factor == 1.25 {
                continue;
            }
            let state = PetGeometryState::default();
            let old = *state.0.lock().unwrap();
            let mut window = Window::new(&state);
            window.fail = fail;
            window.factor = factor;
            apply_native(&state, &window, |_| gif(0.5));
            assert_eq!(*state.0.lock().unwrap(), old);
            assert_eq!(*window.calls.borrow(), ["position", "size", "factor"]);
            assert_eq!(window.size.get(), tauri::PhysicalSize::new(200, 263));
        }
    }
}
#[test]
fn resize_failure_restores_old_geometry_but_position_failure_keeps_applied_geometry() {
    for fail in ["resize", "reposition"] {
        let state = PetGeometryState::default();
        let old = *state.0.lock().unwrap();
        let mut window = Window::new(&state);
        window.fail = Some(fail);
        let target = gif(0.5);
        window.expected.set(target);
        apply_native(&state, &window, |_| target);
        assert_eq!(window.position.get(), tauri::PhysicalPosition::new(40, 50));
        if fail == "resize" {
            assert_eq!(*state.0.lock().unwrap(), old);
            assert_eq!(window.size.get(), tauri::PhysicalSize::new(200, 263));
            assert!(!window.calls.borrow().contains(&"reposition"));
        } else {
            assert_eq!(*state.0.lock().unwrap(), target);
            assert_ne!(window.size.get(), tauri::PhysicalSize::new(200, 263));
        }
    }
}
#[test]
fn drawing_anchor_getters_release_snapshot_guard() {
    let state = PetGeometryState(std::sync::Mutex::new(gif(0.5)));
    let window = Window::new(&state);
    let anchor = drawing_anchor_native(&state, &window).unwrap();
    assert_eq!(anchor.x, 100.0);
    assert!((anchor.y - 147.0).abs() < 1e-9);
    assert_eq!(*window.calls.borrow(), ["size", "factor"]);
    for fail in ["size", "factor"] {
        let mut failed = Window::new(&state);
        failed.fail = Some(fail);
        assert!(drawing_anchor_native(&state, &failed).is_none());
    }
    for factor in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut invalid = Window::new(&state);
        invalid.factor = factor;
        assert!(drawing_anchor_native(&state, &invalid).is_none());
    }
}
#[test]
fn queued_scale_and_configure_resolve_latest_state_when_executed() {
    let state = PetGeometryState::default();
    let window = Window::new(&state);
    let pending_scale = scale_update(2.0);
    let pending_configure = configure_update(true, Some(envelope(1.8, 0.2)));
    let target = gif(0.5);
    window.expected.set(target);
    apply_native(&state, &window, |_| target);
    window.expected.set(PetGeometry {
        scale: 2.0,
        ..target
    });
    apply_native(&state, &window, pending_scale);
    window.expected.set(PetGeometry {
        scale: 2.0,
        gif: true,
        envelope: Some(envelope(1.8, 0.2)),
    });
    apply_native(&state, &window, pending_configure);
    assert_eq!(*state.0.lock().unwrap(), window.expected.get());
}
#[test]
fn explicit_target_persona_wins_over_cached_source_geometry() {
    let fixtures = [
        ("rig", true, Some(envelope(1.0, 0.02))),
        ("gif", true, Some(envelope(1.2, 0.08))),
        ("glb", false, None),
    ];
    for source in fixtures {
        for target in fixtures {
            if source.0 == target.0 {
                continue;
            }
            let state = PetGeometryState(std::sync::Mutex::new(PetGeometry {
                scale: 0.5,
                gif: source.1,
                envelope: source.2,
            }));
            let window = Window::new(&state);
            let next = target_geometry(0.5, target.0, |id| {
                assert_eq!(id, target.0);
                assert_ne!(id, source.0);
                (target.1, target.2)
            });
            window.expected.set(next);
            apply_native(&state, &window, |_| next);
            assert_eq!(state.0.lock().unwrap().envelope, target.2);
        }
    }
    let glb = target_geometry(0.5, "glb", |_| (false, Some(envelope(1.2, 0.08))));
    assert_eq!(glb.envelope, None);
}

#[test]
fn repeated_switch_and_scale_cycles_do_not_accumulate_rounding_drift() {
    let state = PetGeometryState::default();
    let window = Window::new(&state);
    let before = window.foot();
    for _ in 0..10 {
        for two_dimensional in [true, false] {
            for scale in [0.25, 0.5, 1.0, 2.0, 0.5] {
                let target = if two_dimensional {
                    gif(scale)
                } else {
                    PetGeometry {
                        scale,
                        gif: false,
                        envelope: None,
                    }
                };
                window.expected.set(target);
                // Live preview followed by persisted settings repeats the same native geometry.
                apply_native(&state, &window, |_| target);
                apply_native(&state, &window, scale_update(scale));
            }
        }
    }
    let after = window.foot();
    assert!(
        (after.0 - before.0).abs() <= 1.0 && (after.1 - before.1).abs() <= 1.0,
        "cumulative anchor drift: before={before:?} after={after:?}"
    );
}
