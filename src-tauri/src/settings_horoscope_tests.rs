use super::Settings;

#[test]
fn legacy_settings_default_horoscope_sign_without_losing_other_values() {
    let settings: Settings =
        serde_json::from_str(r#"{"theme":"mint","userName":"Legacy"}"#).expect("legacy settings");

    assert_eq!(settings.horoscope_sign, None);
    assert_eq!(settings.theme, "mint");
    assert_eq!(settings.user_name, "Legacy");
}

#[test]
fn null_unknown_or_wrong_type_only_clears_horoscope_sign() {
    for malformed in [
        "null",
        r#""unknown""#,
        r#""Aries""#,
        "false",
        "42",
        "[]",
        r#"{"sign":"aries"}"#,
    ] {
        let document =
            format!(r#"{{"theme":"peach","userName":"Keep me","horoscopeSign":{malformed}}}"#);
        let settings: Settings = serde_json::from_str(&document).expect("settings");

        assert_eq!(settings.horoscope_sign, None, "accepted {malformed}");
        assert_eq!(settings.theme, "peach");
        assert_eq!(settings.user_name, "Keep me");
    }
}

#[test]
fn all_valid_signs_round_trip_as_camel_case_field() {
    for sign in [
        "aries",
        "taurus",
        "gemini",
        "cancer",
        "leo",
        "virgo",
        "libra",
        "scorpio",
        "sagittarius",
        "capricorn",
        "aquarius",
        "pisces",
    ] {
        let document = format!(r#"{{"horoscopeSign":"{sign}"}}"#);
        let settings: Settings = serde_json::from_str(&document).expect("valid sign");
        assert_eq!(settings.horoscope_sign.as_deref(), Some(sign));

        let serialized = serde_json::to_value(&settings).expect("serialize settings");
        assert_eq!(serialized["horoscopeSign"], sign);
        assert!(serialized.get("horoscope_sign").is_none());
    }
}
