use super::contract::{Operation, Preferences, Snapshot, TimerError};
use super::core::Timer;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const CHANGED_EVENT: &str = "deskmate://pomodoro-changed";

pub struct PomodoroState {
    timer: Mutex<Timer>,
    origin: Instant,
    stopped: Arc<AtomicBool>,
}

impl Default for PomodoroState {
    fn default() -> Self {
        Self {
            timer: Mutex::new(Timer::new(Preferences::default())),
            origin: Instant::now(),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub(super) fn execute(
    app: &tauri::AppHandle,
    operation: Operation,
) -> Result<Snapshot, TimerError> {
    let state = app.state::<PomodoroState>();
    let (snapshot, changed) = {
        let mut timer = state
            .timer
            .lock()
            .map_err(|_| TimerError::StateUnavailable)?;
        let revision = timer.revision();
        let snapshot = timer.dispatch(operation, state.origin.elapsed())?;
        let changed = revision != snapshot.revision;
        (snapshot, changed)
    };
    if changed {
        if let Err(error) = app.emit(CHANGED_EVENT, &snapshot) {
            eprintln!("failed to emit Pomodoro change: {error}");
        }
    }
    Ok(snapshot)
}

pub fn apply_preferences(app: &tauri::AppHandle, preferences: Preferences) -> Result<(), String> {
    execute(app, Operation::Configure(preferences))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn start_checker(app: tauri::AppHandle) -> std::io::Result<()> {
    let stopped = Arc::clone(&app.state::<PomodoroState>().stopped);
    std::thread::Builder::new()
        .name("yume-pomodoro".into())
        .spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(200));
                if stopped.load(Ordering::Acquire) {
                    break;
                }
                if let Err(error) = execute(&app, Operation::Get) {
                    eprintln!("Pomodoro checker stopped: {error}");
                    break;
                }
            }
        })?;
    Ok(())
}

pub fn stop_checker(app: &tauri::AppHandle) {
    app.state::<PomodoroState>()
        .stopped
        .store(true, Ordering::Release);
}
