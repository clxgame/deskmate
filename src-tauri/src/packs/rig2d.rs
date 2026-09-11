use serde::Deserialize;
use std::{collections::BTreeMap, fs, io::Cursor, path::Path};

const STATES: [&str; 6] = ["idle", "thinking", "talking", "working", "error", "sleep"];
const MAX_PNG_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Figure {
    schema_version: u32,
    renderer: String,
    canvas: Canvas,
    states: BTreeMap<String, State>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Canvas { width: u16, height: u16 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    textures: Vec<String>,
    rig: Rig,
    alignment: Alignment,
    hit_polygon: Vec<[f64; 2]>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rig {
    neck: [f64; 2],
    eyes: [f64; 4],
    eye_angle: f64,
    eye_radius: [f64; 2],
    mouth: [f64; 4],
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Alignment { blink: [[f64; 3]; 2], mouth: [[f64; 3]; 2] }

fn bounded(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}
fn safe_png_path(path: &str) -> bool {
    let Some(stem) = path.strip_prefix("assets/").and_then(|file| file.strip_suffix(".png")) else { return false; };
    path.len() <= 512 && stem.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && stem.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_')
}
pub(super) fn parse_config(bytes: &[u8]) -> Result<Figure, String> {
    if bytes.len() > 128 * 1024 { return Err("rig2d config too large".into()); }
    let figure: Figure = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    if figure.schema_version != 1 || figure.renderer != "silver-cat-v1"
        || figure.canvas.width != 512 || figure.canvas.height != 512
        || figure.states.len() != STATES.len()
        || STATES.iter().any(|state| !figure.states.contains_key(*state)) {
        return Err("rig2d schema, renderer or states invalid".into());
    }
    for (name, state) in &figure.states {
        let texture_count = match name.as_str() { "sleep" => 1, "talking" => 3, _ => 2 };
        let rig = &state.rig;
        if state.textures.len() != texture_count || state.textures.iter().any(|path| !safe_png_path(path))
            || rig.neck.iter().chain(&rig.eyes).chain(&rig.mouth).any(|v| !bounded(*v, 0.0, 512.0))
            || rig.eye_radius.iter().chain(&rig.mouth[2..]).any(|v| !bounded(*v, 0.0, 512.0) || *v == 0.0)
            || !bounded(rig.eye_angle, -std::f64::consts::PI, std::f64::consts::PI)
            || !super::figure2d::simple_polygon(&state.hit_polygon, 128, 512.0) {
            return Err(format!("rig2d state invalid: {name}"));
        }
        for row in state.alignment.blink.iter().chain(&state.alignment.mouth) {
            if !bounded(row[0], -4.0, 4.0) || !bounded(row[1], -4.0, 4.0) || !bounded(row[2], -512.0, 512.0) {
                return Err(format!("rig2d alignment invalid: {name}"));
            }
        }
    }
    Ok(figure)
}

pub(super) fn validate(root: &Path) -> Result<(), String> {
    fs::read_to_string(root.join("persona.md")).map_err(|error| format!("rig2d persona.md missing: {error}"))?;
    let path = root.join("figure-rig2d.json");
    if fs::metadata(&path).map_err(|error| error.to_string())?.len() > 128 * 1024 {
        return Err("rig2d config too large".into());
    }
    let figure = parse_config(&fs::read(path).map_err(|error| error.to_string())?)?;
    for state in figure.states.values() {
        for texture in &state.textures {
            let path = root.join(texture);
            if fs::metadata(&path).map_err(|error| error.to_string())?.len() > MAX_PNG_BYTES {
                return Err("rig2d PNG too large".into());
            }
            validate_png(&fs::read(path).map_err(|error| error.to_string())?)?;
        }
    }
    Ok(())
}

pub(super) fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 8 * 1024 * 1024 { return Err("rig2d PNG too large".into()); }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: 16 * 1024 * 1024 });
    decoder.ignore_checksums(false);
    let mut reader = decoder.read_info().map_err(|error| format!("rig2d PNG invalid: {error}"))?;
    let info = reader.info();
    if info.width != 512 || info.height != 512 || info.animation_control.is_some()
        || info.bit_depth != png::BitDepth::Eight || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba) || info.interlaced {
        return Err("rig2d PNG must be a static noninterlaced 512x512 RGB8/RGBA8 image".into());
    }
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).map_err(|error| format!("rig2d PNG decode failed: {error}"))?;
    reader.finish().map_err(|error| format!("rig2d PNG truncated: {error}"))?;
    Ok(())
}
