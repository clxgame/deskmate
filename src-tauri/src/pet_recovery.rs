//! Keep the drawing frame reachable after restoring a position or changing displays.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::Manager;

use crate::window_layout::{Point, Rect, Size};

#[derive(Default)]
pub(crate) struct RecoveryState {
    stopped: Arc<AtomicBool>,
    observation: Mutex<Observation>,
}

#[derive(Debug, Clone, PartialEq)]
struct Layout {
    areas: Vec<Rect>,
    frame_size: Size,
    frame_offset: Point,
    factor: f64,
}

#[derive(Default)]
struct Observation {
    last: Option<Layout>,
    pending: bool,
}

impl Observation {
    // Wait for native resize/position operations to settle. Position is deliberately
    // absent from Layout: ordinary dragging must not continually snap the pet back.
    fn settled_change(&mut self, layout: Layout) -> bool {
        if self.last.as_ref() != Some(&layout) {
            self.last = Some(layout);
            self.pending = true;
            return false;
        }
        std::mem::take(&mut self.pending)
    }
}

struct Snapshot {
    origin: Point,
    frame: Rect,
    layout: Layout,
}

fn monitor_area(monitor: &tauri::Monitor, factor: f64) -> Rect {
    let area = monitor.work_area();
    // Cocoa has one global coordinate space in points. Tao exposes each monitor
    // in that monitor's backing pixels, but window positions use the window's
    // scale. Normalize before comparing mixed-DPI monitors on macOS.
    #[cfg(target_os = "macos")]
    let (position, size) = (
        area.position
            .to_logical::<f64>(monitor.scale_factor())
            .to_physical::<i32>(factor),
        area.size
            .to_logical::<f64>(monitor.scale_factor())
            .to_physical::<u32>(factor),
    );
    #[cfg(not(target_os = "macos"))]
    let (position, size) = {
        let _ = factor;
        (area.position, area.size)
    };
    Rect {
        x: i64::from(position.x),
        y: i64::from(position.y),
        width: i64::from(size.width),
        height: i64::from(size.height),
    }
}

fn snapshot(pet: &tauri::WebviewWindow) -> Result<Snapshot, String> {
    let factor = pet.scale_factor().map_err(|error| error.to_string())?;
    let position = pet.outer_position().map_err(|error| error.to_string())?;
    // GIF/rig windows have transparent travel padding. Keep the drawing frame,
    // rather than that padding, inside the work area.
    let frame = crate::pet_geometry::chat_bounds(pet)?;
    let mut areas: Vec<_> = pet
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(|monitor| monitor_area(monitor, factor))
        .filter(|area| area.width > 0 && area.height > 0)
        .collect();
    areas.sort_by_key(|area| (area.x, area.y, area.width, area.height));
    if let Some(primary) = pet.primary_monitor().map_err(|error| error.to_string())? {
        let primary = monitor_area(&primary, factor);
        if let Some(index) = areas.iter().position(|area| *area == primary) {
            areas.swap(0, index);
        }
    }
    let origin = Point {
        x: i64::from(position.x),
        y: i64::from(position.y),
    };
    Ok(Snapshot {
        origin,
        frame,
        layout: Layout {
            areas,
            frame_size: Size {
                width: frame.width,
                height: frame.height,
            },
            frame_offset: Point {
                x: frame.x - origin.x,
                y: frame.y - origin.y,
            },
            factor,
        },
    })
}

fn fit_axis(value: i64, size: i64, start: i64, available: i64) -> i64 {
    if size > available {
        // If the user deliberately chooses a very large scale, center the drawing
        // instead of pushing its center offscreen. A repeated check is idempotent.
        start + (available - size) / 2
    } else {
        value.clamp(start, start + available - size)
    }
}

fn corrected_origin(origin: Point, frame: Rect, areas: &[Rect], reset: bool) -> Option<Point> {
    let primary = *areas.first()?;
    let fit = |area: Rect| Point {
        x: fit_axis(frame.x, frame.width, area.x, area.width),
        y: fit_axis(frame.y, frame.height, area.y, area.height),
    };
    let current = Point {
        x: frame.x,
        y: frame.y,
    };
    if !reset && areas.iter().any(|area| fit(*area) == current) {
        return None;
    }
    let target = if reset {
        Point {
            x: fit_axis(
                primary.x + primary.width - frame.width - 16,
                frame.width,
                primary.x,
                primary.width,
            ),
            y: fit_axis(
                primary.y + primary.height - frame.height - 16,
                frame.height,
                primary.y,
                primary.height,
            ),
        }
    } else {
        // Pick the work area requiring the least movement; disconnected monitors
        // naturally disappear from this list, including negative-coordinate ones.
        areas.iter().map(|area| fit(*area)).min_by_key(|point| {
            let dx = i128::from(point.x - current.x);
            let dy = i128::from(point.y - current.y);
            dx * dx + dy * dy
        })?
    };
    Some(Point {
        x: origin.x + target.x - frame.x,
        y: origin.y + target.y - frame.y,
    })
}

fn apply(pet: &tauri::WebviewWindow, snapshot: &Snapshot, reset: bool) -> Result<(), String> {
    if let Some(point) = corrected_origin(
        snapshot.origin,
        snapshot.frame,
        &snapshot.layout.areas,
        reset,
    ) {
        pet.set_position(tauri::PhysicalPosition::new(point.x as f64, point.y as f64))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn ensure_reachable(pet: &tauri::WebviewWindow) -> Result<(), String> {
    apply(pet, &snapshot(pet)?, false)
}

pub(crate) fn find_pet(app: &tauri::AppHandle) {
    if let Some(pet) = app.get_webview_window("pet") {
        // Show first: on macOS set_position is queued, so the ordinary show-time
        // recovery must not overwrite the explicit primary-screen destination.
        crate::pet_visibility::request(app, Some(true));
        if let Err(error) = snapshot(&pet).and_then(|snapshot| apply(&pet, &snapshot, true)) {
            eprintln!("could not restore pet position: {error}");
        }
    }
}

/// Monitor changes are not guaranteed to deliver a window event (e.g. unplugging
/// a display while hidden). Observe layout, not position, once per second.
pub(crate) fn start(app: tauri::AppHandle) -> std::io::Result<()> {
    let stopped = Arc::clone(&app.state::<RecoveryState>().stopped);
    std::thread::Builder::new()
        .name("yume-pet-recovery".into())
        .spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_secs(1));
                if stopped.load(Ordering::Acquire) {
                    break;
                }
                let handle = app.clone();
                if app
                    .run_on_main_thread(move || {
                        let state = handle.state::<RecoveryState>();
                        if state.stopped.load(Ordering::Acquire) {
                            return;
                        }
                        let Some(pet) = handle.get_webview_window("pet") else {
                            return;
                        };
                        let Ok(snapshot) = snapshot(&pet) else {
                            return;
                        };
                        let changed = state
                            .observation
                            .lock()
                            .map(|mut observation| {
                                observation.settled_change(snapshot.layout.clone())
                            })
                            .unwrap_or(false);
                        if changed {
                            if let Err(error) = apply(&pet, &snapshot, false) {
                                eprintln!("pet position recovery failed: {error}");
                            }
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })?;
    Ok(())
}

pub(crate) fn stop(app: &tauri::AppHandle) {
    app.state::<RecoveryState>()
        .stopped
        .store(true, Ordering::Release);
}

#[cfg(test)]
#[path = "pet_recovery_tests.rs"]
mod tests;
