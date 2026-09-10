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
    pub(crate) horizontal: f64,
    pub(crate) top: f64,
    pub(crate) bottom: f64,
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
    let envelope = envelope.or_else(|| {
        if gif {
            let state = pet.state::<crate::settings::SettingsState>();
            let persona_id = state.0.lock().ok()?.persona_id.clone();
            crate::packs::persona_gif_envelope(pet.app_handle(), &persona_id)
        } else {
            None
        }
    });
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
pub(crate) fn drawing_anchor(pet: &tauri::WebviewWindow) -> Option<tauri::PhysicalPosition<f64>> {
    let state = pet.state::<PetGeometryState>();
    let geometry = state.0.lock().ok()?;
    let size = pet.outer_size().ok()?;
    let factor = pet.scale_factor().ok()?;
    let frame = if geometry.gif { 320.0 } else { 420.0 } * geometry.scale();
    Some(tauri::PhysicalPosition::new(
        f64::from(size.width) / 2.0,
        f64::from(size.height) - (geometry.bottom() + frame / 2.0) * factor,
    ))
}
fn chat_frame(
    geometry: PetGeometry,
    size: tauri::PhysicalSize<u32>,
    factor: f64,
) -> crate::window_layout::Rect {
    if !geometry.gif {
        return crate::window_layout::Rect {
            x: 0,
            y: 0,
            width: i64::from(size.width),
            height: i64::from(size.height),
        };
    }
    let frame = 320.0 * geometry.scale();
    let logical = size.to_logical::<f64>(factor);
    let origin = tauri::LogicalPosition::new(
        (logical.width - frame) / 2.0,
        logical.height - geometry.bottom() - frame,
    )
    .to_physical::<i32>(factor);
    let extent = tauri::LogicalSize::new(frame, frame).to_physical::<u32>(factor);
    crate::window_layout::Rect {
        x: i64::from(origin.x),
        y: i64::from(origin.y),
        width: i64::from(extent.width),
        height: i64::from(extent.height),
    }
}
pub(crate) fn chat_bounds(
    pet: &tauri::WebviewWindow,
) -> Result<crate::window_layout::Rect, String> {
    let state = pet.state::<PetGeometryState>();
    let geometry = *state.0.lock().map_err(|error| error.to_string())?;
    let position = pet.outer_position().map_err(|error| error.to_string())?;
    let size = pet.outer_size().map_err(|error| error.to_string())?;
    let factor = pet.scale_factor().map_err(|error| error.to_string())?;
    let frame = chat_frame(geometry, size, factor);
    Ok(crate::window_layout::Rect {
        x: i64::from(position.x) + frame.x,
        y: i64::from(position.y) + frame.y,
        ..frame
    })
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
    let current = *app
        .state::<PetGeometryState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(pet) = app.get_webview_window("pet") {
        apply_geometry(
            &pet,
            PetGeometry {
                scale: current.scale,
                gif,
                envelope: if gif {
                    envelope.or_else(|| {
                        let state = app.state::<crate::settings::SettingsState>();
                        let persona_id = state.0.lock().ok()?.persona_id.clone();
                        crate::packs::persona_gif_envelope(&app, &persona_id)
                    })
                } else {
                    None
                },
            },
        );
    }
    Ok(())
}
#[cfg(test)]
#[path = "pet_geometry_tests.rs"]
mod tests;
