use super::{apply_and_publish_settings, PetPosition, Settings, SettingsState};
use std::sync::Mutex;

#[test]
fn native_move_during_settings_apply_survives_publication_and_notification() {
    let source = Settings {
        persona_id: "baobao".into(),
        pet_position: Some(PetPosition { x: 2384, y: 1124 }),
        ..Settings::default()
    };
    let state = SettingsState(Mutex::new(source.clone()));
    let requested = Settings {
        persona_id: "xiaoxiongchong".into(),
        ..source
    };
    let live_position = PetPosition { x: 2244, y: 1124 };
    let notified = apply_and_publish_settings(&state, &requested, || {
        let mut current = state
            .0
            .try_lock()
            .expect("settings apply must run without a settings guard");
        current.pet_position = Some(live_position);
        current.theme = "dark".into();
    })
    .unwrap();
    assert_eq!(state.0.lock().unwrap().pet_position, Some(live_position));
    assert_eq!(notified.pet_position, Some(live_position));
    assert_eq!(notified.persona_id, "xiaoxiongchong");
    assert_eq!(
        notified.theme, "dark",
        "callback changes must not be overwritten by stale request"
    );
}

#[test]
fn native_settings_effects_see_accepted_persona() {
    let state = SettingsState(Mutex::new(Settings::default()));
    let requested = Settings {
        persona_id: "xiaoxiongchong".into(),
        ..Settings::default()
    };
    apply_and_publish_settings(&state, &requested, || {
        assert_eq!(state.0.try_lock().unwrap().persona_id, requested.persona_id);
    })
    .unwrap();
}
