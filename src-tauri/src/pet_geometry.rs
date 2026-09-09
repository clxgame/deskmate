use std::sync::Mutex;
use tauri::Manager;

pub(crate) struct PetGeometryState(Mutex<PetGeometry>);
impl Default for PetGeometryState {
    fn default() -> Self {
        Self(Mutex::new(PetGeometry {
            scale: 1.0,
            gif: false,
            envelope: None,
        }))
    }
}
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GifEnvelope {
    horizontal: f64,
    top: f64,
    bottom: f64,
}
impl GifEnvelope {
    fn valid(self) -> bool {
        self.horizontal.is_finite()
            && (1.0..=3.0).contains(&self.horizontal)
            && self.top.is_finite()
            && (1.0..=3.0).contains(&self.top)
            && self.bottom.is_finite()
            && (0.0..=1.0).contains(&self.bottom)
    }
}
#[derive(Clone, Copy)]
struct PetGeometry {
    scale: f64,
    gif: bool,
    envelope: Option<GifEnvelope>,
}
impl PetGeometry {
    fn scale(self) -> f64 {
        if self.scale.is_finite() {
            self.scale.clamp(0.1, 2.0)
        } else {
            0.5
        }
    }
    fn bottom(self) -> f64 {
        self.envelope
            .map_or(0.0, |value| value.bottom * 320.0 * self.scale())
    }
}
fn dimensions(geometry: PetGeometry) -> (f64, f64) {
    let scale = geometry.scale();
    let host_scale = scale.max(0.5);
    let width = 320.0 * host_scale + if geometry.gif { 320.0 * scale } else { 0.0 };
    let height = 420.0 * host_scale;
    geometry.envelope.map_or((width, height), |value| {
        (
            width.max(640.0 * scale * value.horizontal),
            height.max(320.0 * scale * value.top) + geometry.bottom(),
        )
    })
}
fn anchored_origin(
    position: (f64, f64),
    old_anchor: (f64, f64),
    new_anchor: (f64, f64),
) -> (f64, f64) {
    (
        position.0 + old_anchor.0 - new_anchor.0,
        position.1 + old_anchor.1 - new_anchor.1,
    )
}
fn pixel_size(size: (f64, f64), factor: f64) -> (f64, f64) {
    let dpi = (factor * 96.0).round();
    let (mut a, mut b) = (96.0, dpi);
    while b > 0.0 {
        (a, b) = (b, a % b);
    }
    let unit = 96.0 / a;
    (
        (size.0 / unit).ceil() * unit * factor,
        (size.1 / unit).ceil() * unit * factor,
    )
}
fn apply_geometry(pet: &tauri::WebviewWindow, next: PetGeometry) {
    let state = pet.state::<PetGeometryState>();
    let Ok(mut geometry) = state.0.lock() else {
        return;
    };
    let (Ok(position), Ok(size), Ok(factor)) =
        (pet.outer_position(), pet.outer_size(), pet.scale_factor())
    else {
        return;
    };
    if !factor.is_finite() || factor <= 0.0 || !(factor * 96.0).is_finite() {
        return;
    }
    let position = position.to_logical::<f64>(factor);
    let size = size.to_logical::<f64>(factor);
    let nominal = dimensions(next);
    let (width, height) = if next.envelope.is_some() {
        let physical = pixel_size(nominal, factor);
        if pet
            .set_size(tauri::PhysicalSize::new(physical.0, physical.1))
            .is_err()
        {
            return;
        }
        (physical.0 / factor, physical.1 / factor)
    } else {
        if pet
            .set_size(tauri::LogicalSize::new(nominal.0, nominal.1))
            .is_err()
        {
            return;
        }
        nominal
    };
    let (x, y) = anchored_origin(
        (position.x, position.y),
        (size.width / 2.0, size.height - geometry.bottom()),
        (width / 2.0, height - next.bottom()),
    );
    let _ = pet.set_position(tauri::LogicalPosition::new(x, y));
    *geometry = next;
}
pub(crate) fn apply(pet: &tauri::WebviewWindow, scale: f64, gif: bool) {
    let envelope = match pet.state::<PetGeometryState>().0.lock() {
        Ok(geometry) => {
            if gif {
                geometry.envelope
            } else {
                None
            }
        }
        Err(_) => return,
    };
    apply_geometry(
        pet,
        PetGeometry {
            scale,
            gif,
            envelope,
        },
    );
}
pub(crate) fn apply_scale(pet: &tauri::WebviewWindow, scale: f64) {
    let current = match pet.state::<PetGeometryState>().0.lock() {
        Ok(value) => *value,
        Err(_) => return,
    };
    apply_geometry(pet, PetGeometry { scale, ..current });
}
#[tauri::command]
pub(crate) fn configure_pet_geometry(
    app: tauri::AppHandle,
    gif: bool,
    envelope: Option<GifEnvelope>,
) -> Result<(), String> {
    if envelope.is_some_and(|value| !value.valid()) {
        return Err("Invalid GIF drawing envelope".into());
    }
    let scale = app
        .state::<PetGeometryState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .scale;
    if let Some(pet) = app.get_webview_window("pet") {
        apply_geometry(
            &pet,
            PetGeometry {
                scale,
                gif,
                envelope: if gif { envelope } else { None },
            },
        );
    }
    Ok(())
}
#[cfg(test)]
#[path = "pet_geometry_tests.rs"]
mod tests;
