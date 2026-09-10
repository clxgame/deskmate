use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FigureV2 {
    schema_version: u32,
    canvas: super::Canvas,
    animations: BTreeMap<String, AnimationV2>,
    feedback: super::Feedback,
    leaving: super::Leaving,
    thinking_selection: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnimationV2 {
    file: String,
    scale: f64,
    offset_y: f64,
    offset_x: f64,
    hit_polygon: Vec<[f64; 2]>,
}
pub(super) fn parse(bytes: &[u8]) -> Result<super::Figure, String> {
    let input: FigureV2 = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if input.schema_version != 2 || input.thinking_selection != "random" {
        return Err("figure2d v2 selection invalid".into());
    }
    let mut animations = BTreeMap::new();
    let mut envelope = crate::pet_geometry::GifEnvelope {
        horizontal: 1.0,
        top: 1.0,
        bottom: 0.0,
    };
    for (state, value) in input.animations {
        if !super::bounded(value.offset_x, -240.0, 240.0) || !simple_polygon(&value.hit_polygon) {
            return Err(format!("figure2d v2 geometry invalid: {state}"));
        }
        let left = (1.0 - value.scale) / 2.0 + value.offset_x / 240.0;
        let departure = if state == "leaving" {
            input.leaving.translate_x_ratio * value.scale
        } else {
            0.0
        };
        envelope.horizontal = envelope
            .horizontal
            .max(0.5 - left - departure)
            .max(left + value.scale - 0.5);
        envelope.top = envelope.top.max(value.scale + value.offset_y / 240.0);
        envelope.bottom = envelope.bottom.max(-value.offset_y / 240.0);
        animations.insert(
            state,
            super::Animation {
                file: value.file,
                scale: value.scale,
                offset_y: value.offset_y,
            },
        );
    }
    Ok(super::Figure {
        envelope: Some(envelope),
        schema_version: 2,
        canvas: input.canvas,
        animations,
        feedback: input.feedback,
        leaving: input.leaving,
        thinking_escalation_ms: 8000.0,
    })
}
fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn on(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> bool {
    cross(a, b, p) == 0.0
        && p[0] >= a[0].min(b[0])
        && p[0] <= a[0].max(b[0])
        && p[1] >= a[1].min(b[1])
        && p[1] <= a[1].max(b[1])
}
fn intersects(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let (x, y, z, w) = (
        cross(a, b, c),
        cross(a, b, d),
        cross(c, d, a),
        cross(c, d, b),
    );
    ((x > 0.0 && y < 0.0 || x < 0.0 && y > 0.0) && (z > 0.0 && w < 0.0 || z < 0.0 && w > 0.0))
        || on(a, b, c)
        || on(a, b, d)
        || on(c, d, a)
        || on(c, d, b)
}
fn simple_polygon(points: &[[f64; 2]]) -> bool {
    if !(3..=64).contains(&points.len())
        || points
            .iter()
            .flatten()
            .any(|v| !super::bounded(*v, 0.0, 240.0))
    {
        return false;
    }
    let mut area = 0.0;
    for i in 0..points.len() {
        let (a, b) = (points[i], points[(i + 1) % points.len()]);
        area += a[0] * b[1] - b[0] * a[1];
        for j in i + 1..points.len() {
            let (c, d) = (points[j], points[(j + 1) % points.len()]);
            if a == c {
                return false;
            }
            if j == i + 1 {
                if on(a, b, d) || on(c, d, a) {
                    return false;
                }
            } else if i == 0 && j == points.len() - 1 {
                if on(a, b, c) || on(c, d, b) {
                    return false;
                }
            } else if intersects(a, b, c, d) {
                return false;
            }
        }
    }
    area != 0.0
}
