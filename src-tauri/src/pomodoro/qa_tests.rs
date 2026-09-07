use super::contract::{Operation, Phase, Preferences};
use super::core::Timer;
use serde::Deserialize;
use std::io::{BufRead, Write};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
enum Request {
    Get,
    Start {
        preferences: Preferences,
    },
    Pause,
    Reset,
    SelectPhase {
        phase: Phase,
        preferences: Preferences,
    },
    Advance {
        milliseconds: u64,
    },
}

#[test]
#[ignore = "isolated native timer bridge; never starts the app or reads user data"]
fn qa_pomodoro_bridge() -> Result<(), Box<dyn std::error::Error>> {
    // Given: a process-local timer and injectable monotonic clock.
    let mut timer = Timer::new(Preferences::default());
    let origin = Instant::now();
    let mut offset = Duration::ZERO;
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        let result = (|| -> Result<_, Box<dyn std::error::Error>> {
            let request: Request = serde_json::from_str(&line)?;
            let operation = match request {
                Request::Get => Operation::Get,
                Request::Start { preferences } => Operation::Start(preferences),
                Request::Pause => Operation::Pause,
                Request::Reset => Operation::Reset,
                Request::SelectPhase { phase, preferences } => {
                    Operation::SelectPhase(phase, preferences)
                }
                Request::Advance { milliseconds } => {
                    offset = offset
                        .checked_add(Duration::from_millis(milliseconds))
                        .ok_or("QA clock overflow")?;
                    Operation::Get
                }
            };
            let now = origin
                .elapsed()
                .checked_add(offset)
                .ok_or("QA clock overflow")?;
            // When: dispatching the same operation used by the production command adapter.
            Ok(timer.dispatch(operation, now)?)
        })();
        // Then: the browser adapter receives the real native snapshot or error.
        let envelope = match result {
            Ok(value) => serde_json::json!({ "ok": true, "value": value }),
            Err(error) => serde_json::json!({ "ok": false, "error": error.to_string() }),
        };
        println!("YUME_POMODORO_QA_JSON:{envelope}");
        std::io::stdout().flush()?;
    }
    Ok(())
}
