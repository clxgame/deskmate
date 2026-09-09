use std::sync::Mutex;
use tauri::Manager;

pub(crate) struct PetGeometryState(Mutex<PetGeometry>);

impl Default for PetGeometryState {
    fn default() -> Self {
        Self(Mutex::new(PetGeometry {
            scale: 1.0,
            gif: false,
        }))
    }
}

#[derive(Clone, Copy)]
struct PetGeometry {
    scale: f64,
    gif: bool,
}

fn dimensions(geometry: PetGeometry) -> (f64, f64) {
    let scale = if geometry.scale.is_finite() {
        geometry.scale.clamp(0.1, 2.0)
    } else {
        0.5
    };
    let host_scale = scale.max(0.5);
    let padding = if geometry.gif {
        320.0 * scale * 0.5
    } else {
        0.0
    };
    (320.0 * host_scale + padding * 2.0, 420.0 * host_scale)
}

fn anchored_origin(position: (f64, f64), old_size: (f64, f64), new_size: (f64, f64)) -> (f64, f64) {
    (
        position.0 + (old_size.0 - new_size.0) / 2.0,
        position.1 + old_size.1 - new_size.1,
    )
}

pub(crate) fn apply(pet: &tauri::WebviewWindow, scale: f64, gif: bool) {
    let (Ok(position), Ok(size), Ok(factor)) =
        (pet.outer_position(), pet.outer_size(), pet.scale_factor())
    else {
        return;
    };
    let position = position.to_logical::<f64>(factor);
    let size = size.to_logical::<f64>(factor);
    let (width, height) = dimensions(PetGeometry { scale, gif });
    if pet
        .set_size(tauri::LogicalSize::new(width, height))
        .is_err()
    {
        return;
    }
    let (x, y) = anchored_origin(
        (position.x, position.y),
        (size.width, size.height),
        (width, height),
    );
    let _ = pet.set_position(tauri::LogicalPosition::new(x, y));
    if let Ok(mut geometry) = pet.state::<PetGeometryState>().0.lock() {
        *geometry = PetGeometry { scale, gif };
    }
}

pub(crate) fn apply_scale(pet: &tauri::WebviewWindow, scale: f64) {
    let gif = match pet.state::<PetGeometryState>().0.lock() {
        Ok(geometry) => geometry.gif,
        Err(_) => return,
    };
    apply(pet, scale, gif);
}

#[tauri::command]
pub(crate) fn configure_pet_geometry(app: tauri::AppHandle, gif: bool) {
    let scale = match app.state::<PetGeometryState>().0.lock() {
        Ok(geometry) => geometry.scale,
        Err(_) => return,
    };
    if let Some(pet) = app.get_webview_window("pet") {
        apply(&pet, scale, gif);
    }
}

#[cfg(test)]
mod tests {
    use super::{anchored_origin, dimensions, PetGeometry};

    #[test]
    fn legacy_sizes_when_scale_changes() {
        let scales = [0.1, 0.5, 1.0, 2.0, 3.0];
        let actual = scales.map(|scale| dimensions(PetGeometry { scale, gif: false }));
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
        for scale in [0.1_f64, 0.5, 1.0, 2.0] {
            let (width, _) = dimensions(PetGeometry { scale, gif: true });
            let display_width = 320.0 * scale;
            for ratio in [0.35, 0.5] {
                let left_after_travel = (width - display_width) / 2.0 - display_width * ratio;
                assert!(left_after_travel >= -f64::EPSILON * width);
            }
        }
    }
    #[test]
    fn visual_anchor_survives_persona_and_scale_changes() {
        let origin = (-30.0, 40.0);
        let old = dimensions(PetGeometry {
            scale: 0.5,
            gif: false,
        });
        for scale in [0.1, 0.5, 1.0, 2.0] {
            let next = dimensions(PetGeometry { scale, gif: true });
            let moved = anchored_origin(origin, old, next);
            assert!((moved.0 + next.0 / 2.0 - (origin.0 + old.0 / 2.0)).abs() < 1e-10);
            assert_eq!(moved.1 + next.1, origin.1 + old.1);
            let restored = anchored_origin(moved, next, old);
            assert!((restored.0 - origin.0).abs() < 1e-10);
            assert_eq!(restored.1, origin.1);
        }
    }
}
