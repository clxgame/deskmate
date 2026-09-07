use super::Preferences;
use crate::settings::Settings;

#[test]
fn defaults_preferences_when_loading_legacy_settings() {
    // Given: a settings document from before Pomodoro existed.
    let legacy = r#"{"theme":"mint","userName":"Legacy"}"#;
    // When: deserializing it with current settings.
    let settings: Settings = serde_json::from_str(legacy).expect("legacy");
    // Then: existing preferences survive and only new settings default.
    assert_eq!(settings.theme, "mint");
    assert_eq!(settings.user_name, "Legacy");
    assert_eq!(settings.pomodoro, Preferences::default());
}

#[test]
fn defaults_only_pomodoro_when_stored_preferences_are_malformed() {
    // Given: corrupted Pomodoro data inside otherwise valid settings.
    for malformed in [
        "null",
        "false",
        r#""bad""#,
        r#"{"focusMinutes":0,"breakMinutes":5}"#,
        r#"{"focusMinutes":1.5,"breakMinutes":5}"#,
        r#"{"focusMinutes":25,"breakMinutes":99}"#,
    ] {
        let document =
            format!(r#"{{"theme":"peach","userName":"Keep me","pomodoro":{malformed}}}"#);
        // When: loading that document.
        let settings: Settings = serde_json::from_str(&document).expect("settings");
        // Then: unrelated values remain and the malformed field alone defaults.
        assert_eq!(settings.pomodoro, Preferences::default());
        assert_eq!(settings.theme, "peach");
        assert_eq!(settings.user_name, "Keep me");
    }
}

#[test]
fn persists_only_timer_preferences_when_serializing_settings() {
    // Given: valid custom durations.
    let settings: Settings =
        serde_json::from_str(r#"{"pomodoro":{"focusMinutes":45,"breakMinutes":10}}"#)
            .expect("settings");
    // When: serializing settings for persistence.
    let value = serde_json::to_value(&settings).expect("serialize");
    // Then: preferences round-trip without runtime state.
    assert_eq!(
        value["pomodoro"],
        serde_json::json!({"focusMinutes":45,"breakMinutes":10})
    );
    assert!(value["pomodoro"].get("remainingMs").is_none());
    assert!(value["pomodoro"].get("status").is_none());
}
#[test]
fn rejects_invalid_command_preferences_before_timer_mutation() {
    // Given: command payloads outside the supported duration domain.
    for invalid in [
        r#"{"focusMinutes":0,"breakMinutes":5}"#,
        r#"{"focusMinutes":181,"breakMinutes":5}"#,
        r#"{"focusMinutes":25,"breakMinutes":61}"#,
        r#"{"focusMinutes":-1,"breakMinutes":5}"#,
        r#"{"focusMinutes":25.5,"breakMinutes":5}"#,
        r#"{"focusMinutes":"25","breakMinutes":5}"#,
    ] {
        // When: the command boundary decodes its preferences.
        let result = serde_json::from_str::<Preferences>(invalid);
        // Then: invalid input never enters the timer state machine.
        assert!(result.is_err(), "accepted {invalid}");
    }
}
