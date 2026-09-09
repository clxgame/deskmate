use super::{Lifecycle, Phase};

#[test]
fn hide_waits_for_acknowledgement_when_animated() {
    let mut state = Lifecycle::new(true);
    let request = state.request(false, true).expect("animated request");
    assert!(!state.desired_visible);
    assert_eq!(state.acknowledge(request.token), Some(Phase::Leaving));
    assert_eq!(state.acknowledge(request.token), None);
}

#[test]
fn late_hide_is_ignored_when_show_requested() {
    let mut state = Lifecycle::new(true);
    let hide = state.request(false, true).expect("hide");
    let show = state.request(true, true).expect("show");
    assert_eq!(state.acknowledge(hide.token), None);
    assert!(!state.fallback(hide.token));
    assert_eq!(state.acknowledge(show.token), Some(Phase::Reset));
}

#[test]
fn rapid_toggle_uses_desired_visibility_when_window_still_visible() {
    let mut state = Lifecycle::new(true);
    state.request(false, true);
    state.request(!state.desired_visible, true);
    assert!(state.desired_visible);
    assert_eq!(state.pending.expect("reset").phase, Phase::Reset);
}

#[test]
fn fallback_hides_only_current_unacknowledged_exit() {
    let mut state = Lifecycle::new(true);
    let hide = state.request(false, true).expect("hide");
    assert!(state.fallback(hide.token));
    assert!(!state.fallback(hide.token));
}

#[test]
fn old_reset_is_ignored_when_another_hide_requested() {
    let mut state = Lifecycle::new(false);
    let show = state.request(true, true).expect("show");
    let hide = state.request(false, true).expect("hide");
    assert_eq!(state.acknowledge(show.token), None);
    assert_eq!(state.acknowledge(hide.token), Some(Phase::Leaving));
}

#[test]
fn glb_request_is_immediate_and_invalidates_gif_exit() {
    let mut state = Lifecycle::new(true);
    let hide = state.request(false, true).expect("hide");
    assert_eq!(state.request(true, false), None);
    assert!(!state.fallback(hide.token));
}

#[test]
fn startup_hidden_has_no_pending_animation() {
    let state = Lifecycle::new(false);
    assert!(!state.desired_visible);
    assert_eq!(state.pending, None);
}

#[test]
fn reset_timeout_recovers_only_current_unacknowledged_show() {
    let mut state = Lifecycle::new(false);
    let reset = state.request(true, true).expect("reset");
    assert!(state.reset_timed_out(reset.token));
    assert!(!state.reset_timed_out(reset.token));
}

#[test]
fn reset_timeout_is_ignored_after_new_hide_or_successful_ack() {
    let mut state = Lifecycle::new(false);
    let old = state.request(true, true).expect("reset");
    state.request(false, true);
    assert!(!state.reset_timed_out(old.token));
    let current = state.request(true, true).expect("reset");
    state.acknowledge(current.token);
    assert!(!state.reset_timed_out(current.token));
}

#[test]
fn feedback_visibility_requires_native_visibility_and_desired_visibility() {
    let hidden = Lifecycle::new(false);
    assert!(!hidden.feedback_visible(false));
    assert!(!hidden.feedback_visible(true));
    let shown = Lifecycle::new(true);
    assert!(!shown.feedback_visible(false));
    assert!(shown.feedback_visible(true));
}
