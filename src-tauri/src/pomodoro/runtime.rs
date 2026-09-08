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

/// Poll interval while a deadline is pending. Keeps phase completion within
/// 200ms of the real deadline.
const RUNNING_POLL: Duration = Duration::from_millis(200);
/// Poll interval while the timer is stopped. Nothing can expire on its own, so
/// the checker only needs to notice that the user started it; commands emit
/// their own snapshot immediately, so UI latency is unaffected.
const IDLE_POLL: Duration = Duration::from_secs(2);

/// Returns the wait before the next check, and whether the timer can currently
/// change on its own. A stopped timer is not dispatched at all, so an idle pet
/// emits no events and does not touch the timer mutex.
fn poll_plan(app: &tauri::AppHandle) -> Result<(Duration, bool), TimerError> {
    let state = app.state::<PomodoroState>();
    let running = state
        .timer
        .lock()
        .map_err(|_| TimerError::StateUnavailable)?
        .needs_tick();
    Ok((if running { RUNNING_POLL } else { IDLE_POLL }, running))
}

pub fn start_checker(app: tauri::AppHandle) -> std::io::Result<()> {
    let stopped = Arc::clone(&app.state::<PomodoroState>().stopped);
    std::thread::Builder::new()
        .name("yume-pomodoro".into())
        .spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let (wait, running) = match poll_plan(&app) {
                    Ok(plan) => plan,
                    Err(error) => {
                        eprintln!("Pomodoro checker stopped: {error}");
                        break;
                    }
                };
                std::thread::sleep(wait);
                if stopped.load(Ordering::Acquire) {
                    break;
                }
                if !running {
                    continue;
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
