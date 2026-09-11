use super::{anchored_origin, dimensions, pixel_size, PetGeometry, PetGeometryState};
pub(super) trait NativeGeometry {
    fn position(&self) -> Option<tauri::PhysicalPosition<i32>>;
    fn size(&self) -> Option<tauri::PhysicalSize<u32>>;
    fn factor(&self) -> Option<f64>;
    fn resize(&self, size: tauri::Size) -> bool;
    fn reposition(&self, position: tauri::LogicalPosition<f64>) -> bool;
}
impl NativeGeometry for tauri::WebviewWindow {
    fn position(&self) -> Option<tauri::PhysicalPosition<i32>> {
        self.outer_position().ok()
    }
    fn size(&self) -> Option<tauri::PhysicalSize<u32>> {
        self.outer_size().ok()
    }
    fn factor(&self) -> Option<f64> {
        self.scale_factor().ok()
    }
    fn resize(&self, size: tauri::Size) -> bool {
        self.set_size(size).is_ok()
    }
    fn reposition(&self, position: tauri::LogicalPosition<f64>) -> bool {
        self.set_position(position).is_ok()
    }
}
pub(super) fn apply_native(
    state: &PetGeometryState,
    pet: &impl NativeGeometry,
    update: impl FnOnce(PetGeometry) -> PetGeometry,
) {
    let Ok(current) = state.0.lock().map(|geometry| *geometry) else {
        return;
    };
    let next = update(current);
    let (Some(position), Some(size), Some(factor)) = (pet.position(), pet.size(), pet.factor())
    else {
        return;
    };
    if !factor.is_finite() || factor <= 0.0 || !(factor * 96.0).is_finite() {
        return;
    }
    let position = position.to_logical::<f64>(factor);
    let size = size.to_logical::<f64>(factor);
    if let Ok(mut geometry) = state.0.lock() {
        *geometry = next;
    } else {
        return;
    }
    let nominal = dimensions(next);
    let (width, height) = if next.envelope.is_some() {
        let physical = pixel_size(nominal, factor);
        if !pet.resize(tauri::PhysicalSize::new(physical.0, physical.1).into()) {
            restore_after_failed_resize(state, current, next);
            return;
        }
        (physical.0 / factor, physical.1 / factor)
    } else {
        if !pet.resize(tauri::LogicalSize::new(nominal.0, nominal.1).into()) {
            restore_after_failed_resize(state, current, next);
            return;
        }
        let realized = tauri::LogicalSize::new(nominal.0, nominal.1).to_physical::<u32>(factor);
        (
            f64::from(realized.width) / factor,
            f64::from(realized.height) / factor,
        )
    };
    let (x, y) = anchored_origin(
        (position.x, position.y),
        (size.width / 2.0, size.height - current.bottom()),
        (width / 2.0, height - next.bottom()),
    );
    pet.reposition(tauri::LogicalPosition::new(x, y));
}
fn restore_after_failed_resize(state: &PetGeometryState, current: PetGeometry, next: PetGeometry) {
    if let Ok(mut geometry) = state.0.lock() {
        if *geometry == next {
            *geometry = current;
        }
    }
}
pub(super) fn drawing_anchor_native(
    state: &PetGeometryState,
    pet: &impl NativeGeometry,
) -> Option<tauri::PhysicalPosition<f64>> {
    let geometry = *state.0.lock().ok()?;
    let size = pet.size()?;
    let factor = pet.factor()?;
    if !factor.is_finite() || factor <= 0.0 {
        return None;
    }
    let frame = if geometry.gif { 320.0 } else { 420.0 } * geometry.scale();
    Some(tauri::PhysicalPosition::new(
        f64::from(size.width) / 2.0,
        f64::from(size.height) - (geometry.bottom() + frame / 2.0) * factor,
    ))
}
