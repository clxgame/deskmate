#[path = "figure2d_v2.rs"]
mod v2;
use super::manifest::{PackManifest, RenderType};
use serde::Deserialize;
use std::{collections::BTreeMap, fs, path::Path};

const STATES: [&str; 7] = [
    "idle", "thinking", "working", "talking", "success", "error", "leaving",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Figure {
    schema_version: u32,
    canvas: Canvas,
    animations: BTreeMap<String, Animation>,
    feedback: Feedback,
    leaving: Leaving,
    thinking_escalation_ms: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Canvas {
    width: u16,
    height: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Animation {
    file: String,
    scale: f64,
    offset_y: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Feedback {
    success_ms: f64,
    error_ms: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Leaving {
    duration_ms: f64,
    translate_x_ratio: f64,
    position_easing: String,
    opacity_easing: String,
}

fn bounded(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}

pub(super) fn validate_personas(root: &Path, manifest: &PackManifest) -> Result<(), String> {
    for persona in &manifest.personas {
        match persona.render_type {
            RenderType::Glb => {}
            RenderType::Gif => validate(&root.join("personas").join(&persona.id))?,
        }
    }
    Ok(())
}

fn validate(root: &Path) -> Result<(), String> {
    fs::read_to_string(root.join("persona.md"))
        .map_err(|error| format!("GIF 角色缺少有效 persona.md: {error}"))?;
    let path = root.join("figure2d.json");
    if fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len()
        > super::MAX_MANIFEST_BYTES
    {
        return Err("figure2d.json 过大".into());
    }
    let figure = parse_config(&fs::read(path).map_err(|error| error.to_string())?)?;
    for animation in figure.animations.values() {
        let bytes = fs::read(root.join(&animation.file))
            .map_err(|error| format!("GIF 资源缺失: {error}"))?;
        super::gif::validate(&bytes)?;
    }
    Ok(())
}

pub(super) fn parse_config(bytes: &[u8]) -> Result<Figure, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let figure = match value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(1) => serde_json::from_slice(bytes).map_err(|e| e.to_string())?,
        Some(2) => v2::parse(bytes)?,
        _ => return Err("figure2d.json schemaVersion unsupported".into()),
    };
    if ![1, 2].contains(&figure.schema_version)
        || figure.canvas.width != 240
        || figure.canvas.height != 240
        || figure.animations.len() != STATES.len()
        || !bounded(figure.feedback.success_ms, 1.0, 10_000.0)
        || !bounded(figure.feedback.error_ms, 1.0, 10_000.0)
        || !bounded(figure.thinking_escalation_ms, 1.0, 60_000.0)
        || !bounded(figure.leaving.duration_ms, 1.0, 1100.0)
        || ![-0.35, -0.5].contains(&figure.leaving.translate_x_ratio)
        || figure.leaving.position_easing != "ease-in-out"
        || figure.leaving.opacity_easing != "linear"
    {
        return Err("figure2d.json 参数越界或版本不支持".into());
    }
    for state in STATES {
        let animation = figure
            .animations
            .get(state)
            .ok_or_else(|| format!("缺少 GIF 状态: {state}"))?;
        let placement_valid = match figure.schema_version {
            1 => {
                bounded(animation.scale, 0.1, 1.0)
                    && bounded(animation.offset_y, 0.0, 240.0 * (1.0 - animation.scale))
            }
            2 => bounded(animation.scale, 0.1, 2.0) && bounded(animation.offset_y, -240.0, 240.0),
            _ => false,
        };
        if !placement_valid || !safe_gif_path(&animation.file) {
            return Err(format!("GIF 动作参数或路径无效: {state}"));
        }
    }
    Ok(figure)
}

fn safe_gif_path(value: &str) -> bool {
    let Some(stem) = value.strip_suffix(".gif") else {
        return false;
    };
    value.len() <= 512
        && stem.split('/').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        })
}
