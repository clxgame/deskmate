use serde::Deserialize;
use tauri::PhysicalPosition;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(try_from = "PositionInput")]
pub(crate) struct DefaultPosition {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PositionInput {
    anchor: Anchor,
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
enum Anchor {
    #[serde(rename = "drawing-center")]
    DrawingCenter,
}

impl TryFrom<PositionInput> for DefaultPosition {
    type Error = &'static str;

    fn try_from(input: PositionInput) -> Result<Self, Self::Error> {
        let Anchor::DrawingCenter = input.anchor;
        if [input.x, input.y]
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
        {
            return Err("defaultPosition x/y must be finite ratios in [0, 1]");
        }
        Ok(Self {
            x: input.x,
            y: input.y,
        })
    }
}

impl DefaultPosition {
    pub(crate) fn resolve(
        self,
        area: crate::window_layout::Rect,
        drawing_anchor: PhysicalPosition<f64>,
    ) -> PhysicalPosition<f64> {
        PhysicalPosition::new(
            area.x as f64 + area.width as f64 * self.x - drawing_anchor.x,
            area.y as f64 + area.height as f64 * self.y - drawing_anchor.y,
        )
    }
}

#[cfg(test)]
#[path = "pet_placement_tests.rs"]
mod tests;
