use tauri::{Manager, PhysicalPosition};

pub(crate) fn initial_pet_position(
    saved: Option<crate::settings::PetPosition>,
    default: Option<PhysicalPosition<f64>>,
) -> Option<PhysicalPosition<f64>> {
    saved
        .map(|point| PhysicalPosition::new(f64::from(point.x), f64::from(point.y)))
        .or(default)
}

pub(crate) fn place(
    pet: &tauri::WebviewWindow,
    persona_id: &str,
    saved: Option<crate::settings::PetPosition>,
) {
    let default = if saved.is_none() {
        pack_position(pet, persona_id)
    } else {
        None
    };
    if let Some(point) = initial_pet_position(saved, default) {
        let _ = pet.set_position(point);
    } else {
        crate::place_pet_bottom_right(pet);
    }
}

fn pack_position(pet: &tauri::WebviewWindow, persona_id: &str) -> Option<PhysicalPosition<f64>> {
    let default = crate::packs::persona_default_position(pet.app_handle(), persona_id)?;
    let monitor = pet
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| pet.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some(default.resolve(
        crate::window_layout::Rect {
            x: i64::from(area.position.x),
            y: i64::from(area.position.y),
            width: i64::from(area.size.width),
            height: i64::from(area.size.height),
        },
        crate::pet_geometry::drawing_anchor(pet)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_saved_position_uses_pack_or_generic_fallback() {
        let point = Some(PhysicalPosition::new(2208.0, 1166.0));
        assert_eq!(initial_pet_position(None, point), point);
        assert_eq!(initial_pet_position(None, None), None);
    }

    #[test]
    fn saved_position_takes_priority_over_pack_updates() {
        let saved = Some(crate::settings::PetPosition { x: 100, y: 200 });
        for default in [None, Some(PhysicalPosition::new(2208.0, 1166.0))] {
            assert_eq!(
                initial_pet_position(saved, default),
                Some(PhysicalPosition::new(100.0, 200.0))
            );
        }
    }
}
