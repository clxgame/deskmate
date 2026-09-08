use super::contract::{Operation, Phase, Preferences, Status, TimerError};
use super::core::Timer;
use std::time::Duration;

fn preferences(focus: u16, rest: u16) -> Preferences {
    serde_json::from_value(serde_json::json!({"focusMinutes":focus,"breakMinutes":rest}))
        .expect("preferences")
}

fn running_timer() -> Timer {
    let mut timer = Timer::new(Preferences::default());
    timer
        .dispatch(Operation::Start(Preferences::default()), Duration::ZERO)
        .expect("start");
    timer
}

#[test]
fn starts_running_when_user_starts_focus() {
    // Given: a default idle timer.
    let mut timer = Timer::new(Preferences::default());
    // When: the user starts the timer.
    let snapshot = timer
        .dispatch(Operation::Start(Preferences::default()), Duration::ZERO)
        .expect("start");
    // Then: the native timer runs the default focus duration.
    assert_eq!(snapshot.status, Status::Running);
    assert_eq!(snapshot.phase, Phase::Focus);
    assert_eq!(snapshot.remaining_ms, 1_500_000);
}

#[test]
fn derives_remaining_from_deadline_when_no_view_is_subscribed() {
    // Given: a native timer without any frontend subscription.
    let mut timer = running_timer();
    // When: it is read after 24 minutes and 999 milliseconds.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_millis(1_440_999))
        .expect("read");
    // Then: elapsed time is preserved without requiring interval ticks.
    assert_eq!(snapshot.remaining_ms, 59_001);
    assert_eq!(snapshot.revision, 1);
}

#[test]
fn enters_break_ready_when_exact_focus_deadline_is_reached() {
    // Given: an active focus phase.
    let mut timer = running_timer();
    // When: reading at the exact deadline.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_secs(1500))
        .expect("read");
    // Then: the next phase is ready but does not start automatically.
    assert_eq!(snapshot.status, Status::Ready);
    assert_eq!(snapshot.phase, Phase::Break);
    assert_eq!(snapshot.remaining_ms, 300_000);
    assert_eq!(snapshot.revision, 2);
}

#[test]
fn advances_once_when_sleep_spans_many_possible_rounds() {
    // Given: a timer started before a long system suspension.
    let mut timer = running_timer();
    // When: the clock advances by a week.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_secs(604_800))
        .expect("read");
    // Then: one completion is reported, without invented repeated sessions.
    assert_eq!(snapshot.phase, Phase::Break);
    assert_eq!(snapshot.status, Status::Ready);
    assert_eq!(snapshot.revision, 2);
}

#[test]
fn keeps_completion_revision_when_read_again_after_expiry() {
    // Given: a completed timer awaiting the next start.
    let mut timer = running_timer();
    let completed = timer
        .dispatch(Operation::Get, Duration::from_secs(1500))
        .expect("complete");
    // When: a later checker tick reads it.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_secs(9999))
        .expect("read");
    // Then: completion is not emitted again.
    assert_eq!(snapshot, completed);
}

#[test]
fn holds_remaining_when_paused_without_a_view() {
    // Given: a timer paused partway through focus.
    let mut timer = running_timer();
    timer
        .dispatch(Operation::Pause, Duration::from_millis(10_125))
        .expect("pause");
    // When: reading after a long delay.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_secs(10_000))
        .expect("read");
    // Then: paused remaining time is exact.
    assert_eq!(snapshot.status, Status::Paused);
    assert_eq!(snapshot.remaining_ms, 1_489_875);
}

#[test]
fn resumes_exact_remaining_when_starting_a_paused_phase() {
    // Given: a paused timer.
    let mut timer = running_timer();
    timer
        .dispatch(Operation::Pause, Duration::from_millis(10_125))
        .expect("pause");
    // When: resuming later with the same preferences.
    let snapshot = timer
        .dispatch(
            Operation::Start(Preferences::default()),
            Duration::from_secs(500),
        )
        .expect("resume");
    // Then: no paused time was consumed.
    assert_eq!(snapshot.status, Status::Running);
    assert_eq!(snapshot.remaining_ms, 1_489_875);
}

#[test]
fn does_not_restart_when_start_is_repeated_while_running() {
    // Given: an already running timer.
    let mut timer = running_timer();
    // When: a duplicate start arrives.
    let snapshot = timer
        .dispatch(
            Operation::Start(Preferences::default()),
            Duration::from_secs(10),
        )
        .expect("start");
    // Then: its original deadline and revision are retained.
    assert_eq!(snapshot.remaining_ms, 1_490_000);
    assert_eq!(snapshot.revision, 1);
}

#[test]
fn does_not_autostart_next_phase_when_duplicate_start_arrives_at_expiry() {
    // Given: a running focus phase whose completion has not been observed.
    let mut timer = running_timer();
    // When: a repeated start races the exact deadline.
    let snapshot = timer
        .dispatch(
            Operation::Start(Preferences::default()),
            Duration::from_secs(1500),
        )
        .expect("start");
    // Then: expiry wins and the next phase waits for a fresh start.
    assert_eq!(snapshot.status, Status::Ready);
    assert_eq!(snapshot.phase, Phase::Break);
}

#[test]
fn keeps_pause_idempotent_when_pause_is_repeated() {
    // Given: an already paused timer.
    let mut timer = running_timer();
    let paused = timer
        .dispatch(Operation::Pause, Duration::from_secs(20))
        .expect("pause");
    // When: receiving a later duplicate pause.
    let snapshot = timer
        .dispatch(Operation::Pause, Duration::from_secs(50))
        .expect("pause");
    // Then: remaining time and revision stay stable.
    assert_eq!(snapshot, paused);
}

#[test]
fn resets_current_phase_when_user_resets() {
    // Given: an explicitly selected break running for a minute.
    let mut timer = Timer::new(Preferences::default());
    timer
        .dispatch(
            Operation::SelectPhase(Phase::Break, Preferences::default()),
            Duration::ZERO,
        )
        .expect("select");
    timer
        .dispatch(Operation::Start(Preferences::default()), Duration::ZERO)
        .expect("start");
    // When: resetting the current phase.
    let snapshot = timer
        .dispatch(Operation::Reset, Duration::from_secs(60))
        .expect("reset");
    // Then: break is restored and stopped.
    assert_eq!(snapshot.phase, Phase::Break);
    assert_eq!(snapshot.status, Status::Idle);
    assert_eq!(snapshot.remaining_ms, 300_000);
}

#[test]
fn cannot_restore_stale_deadline_when_reading_after_reset() {
    // Given: an active phase reset before its deadline.
    let mut timer = running_timer();
    let reset = timer
        .dispatch(Operation::Reset, Duration::from_secs(60))
        .expect("reset");
    // When: a stale checker arrives long after the former deadline.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_secs(5000))
        .expect("read");
    // Then: reset remains authoritative.
    assert_eq!(snapshot, reset);
}

#[test]
fn stops_and_selects_phase_when_explicit_selection_changes() {
    // Given: an active focus timer.
    let mut timer = running_timer();
    // When: explicitly selecting break with custom preferences.
    let snapshot = timer
        .dispatch(
            Operation::SelectPhase(Phase::Break, preferences(30, 8)),
            Duration::from_secs(10),
        )
        .expect("select");
    // Then: the requested phase becomes idle at its full duration.
    assert_eq!(snapshot.phase, Phase::Break);
    assert_eq!(snapshot.status, Status::Idle);
    assert_eq!(snapshot.remaining_ms, 480_000);
}

#[test]
fn uses_current_edit_when_start_precedes_settings_save() {
    // Given: native still has the old persisted preferences.
    let mut timer = Timer::new(Preferences::default());
    // When: starting with a just-edited duration before the settings debounce.
    let snapshot = timer
        .dispatch(Operation::Start(preferences(30, 8)), Duration::ZERO)
        .expect("start");
    // Then: the new duration arms immediately.
    assert_eq!(snapshot.duration_ms, 1_800_000);
    assert_eq!(snapshot.remaining_ms, 1_800_000);
}

#[test]
fn latches_current_duration_when_saved_preferences_change_during_run() {
    // Given: a focus phase already running.
    let mut timer = running_timer();
    // When: a settings update arrives with future durations.
    let snapshot = timer
        .dispatch(
            Operation::Configure(preferences(30, 8)),
            Duration::from_secs(10),
        )
        .expect("configure");
    // Then: current progress is preserved and future preferences update.
    assert_eq!(snapshot.duration_ms, 1_500_000);
    assert_eq!(snapshot.remaining_ms, 1_490_000);
    assert_eq!(snapshot.preferences, preferences(30, 8));
}

#[test]
fn uses_latest_rest_duration_when_current_phase_expires() {
    // Given: updated preferences were saved during focus.
    let mut timer = running_timer();
    timer
        .dispatch(
            Operation::Configure(preferences(30, 8)),
            Duration::from_secs(10),
        )
        .expect("configure");
    // When: the latched focus phase completes.
    let snapshot = timer
        .dispatch(Operation::Get, Duration::from_secs(1500))
        .expect("complete");
    // Then: the next phase uses the most recent preferences.
    assert_eq!(snapshot.duration_ms, 480_000);
    assert_eq!(snapshot.status, Status::Ready);
}

#[test]
fn rejects_clock_overflow_without_partial_preference_update() {
    // Given: an idle timer and a clock beyond the supported deadline range.
    let mut timer = Timer::new(Preferences::default());
    let initial = timer
        .dispatch(Operation::Get, Duration::ZERO)
        .expect("initial");
    // When: attempting to start with new preferences at that clock.
    let result = timer.dispatch(Operation::Start(preferences(30, 8)), Duration::MAX);
    // Then: the failed operation leaves state unchanged.
    assert_eq!(result, Err(TimerError::ClockRange));
    assert_eq!(
        timer
            .dispatch(Operation::Get, Duration::ZERO)
            .expect("read"),
        initial
    );
}

#[test]
fn reports_no_tick_needed_for_every_stopped_progress_state() {
    // Given: a timer driven into each state that cannot advance on its own.
    let mut idle = Timer::new(Preferences::default());
    idle.dispatch(Operation::Get, Duration::ZERO).expect("idle");

    let mut paused = running_timer();
    paused
        .dispatch(Operation::Pause, Duration::from_secs(10))
        .expect("pause");

    let mut ready = running_timer();
    ready
        .dispatch(Operation::Get, Duration::from_secs(1500))
        .expect("expire");

    let mut reset = running_timer();
    reset
        .dispatch(Operation::Reset, Duration::from_secs(10))
        .expect("reset");

    // Then: the background checker skips dispatching for all of them, so an
    // untouched pet emits no `pomodoro-changed` event.
    for timer in [&idle, &paused, &ready, &reset] {
        assert!(!timer.needs_tick());
    }
    // And: only a running deadline asks to be polled.
    assert!(running_timer().needs_tick());
}

#[test]
fn keeps_revision_stable_while_stopped_so_idle_emits_no_event() {
    // Given: a stopped timer at its initial revision. `execute` emits only when
    // the revision moves, so a stable revision means a silent event channel.
    let mut timer = Timer::new(Preferences::default());
    let baseline = timer
        .dispatch(Operation::Get, Duration::ZERO)
        .expect("baseline")
        .revision;
    // When: the checker reads it repeatedly across simulated idle minutes.
    for second in 1..=300 {
        let snapshot = timer
            .dispatch(Operation::Get, Duration::from_secs(second))
            .expect("idle read");
        // Then: nothing changes, so no event would be emitted.
        assert_eq!(snapshot.revision, baseline);
        assert_eq!(snapshot.status, Status::Idle);
    }
}
