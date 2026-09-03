use url::Url;

use super::launch::launch_import_with_platform;
use super::launch_fixture::{launch_env, valid_launch, valid_setup, FakePlatform};
use crate::ccswitch::contract::{CcSwitchSetupState, MillisSinceEpoch, ModelChoice};

#[cfg(windows)]
use super::launch::LaunchEnvironment;
#[cfg(windows)]
use crate::ccswitch::platform::SystemCcSwitchPlatform;

#[test]
fn launches_official_opencode_deeplink_after_confirmation_without_leaking_receipt() {
    let state = CcSwitchSetupState::default();
    let canary = format!("runtime-credential-{}", uuid::Uuid::new_v4());
    let staged = state
        .stage_provider(valid_setup(&canary), MillisSinceEpoch(1_000))
        .expect("provider stages");
    let platform = FakePlatform::ready("3.20.0");

    let receipt = launch_import_with_platform(
        launch_env(&state, &platform, 2_000),
        valid_launch(&staged.receipt),
    )
    .expect("handoff launches");

    assert_eq!(platform.actions(), vec!["prepare", "open"]);
    let opened = platform.opened().expect("fake opener saw URL");
    let parsed = Url::parse(&opened).expect("handoff URL parses");
    let pairs = parsed
        .query_pairs()
        .into_owned()
        .collect::<std::collections::HashMap<String, String>>();
    assert_eq!(parsed.scheme(), "ccswitch");
    assert_eq!(parsed.host_str(), Some("v1"));
    assert_eq!(parsed.path(), "/import");
    assert_eq!(pairs.get("resource").map(String::as_str), Some("provider"));
    assert_eq!(pairs.get("app").map(String::as_str), Some("opencode"));
    assert_eq!(
        pairs.get("apiKey").map(String::as_str),
        Some(canary.as_str())
    );
    assert_eq!(pairs.get("model").map(String::as_str), Some("gpt-test"));
    assert_eq!(pairs.get("enabled").map(String::as_str), Some("true"));
    let serialized = serde_json::to_string(&receipt).expect("receipt serializes");
    assert!(!serialized.contains(&canary));
    assert!(!receipt.endpoint.ends_with('/'));
}

#[test]
fn encodes_provider_endpoint_and_model_without_query_injection() {
    let state = CcSwitchSetupState::default();
    let canary = format!("runtime-credential-{}", uuid::Uuid::new_v4());
    let mut setup = valid_setup(&canary);
    setup.provider_name = "Provider & enabled=false".into();
    setup.selected_model = "model&apiKey=bad".into();
    setup.models = vec![ModelChoice {
        id: "model&apiKey=bad".into(),
        name: "Injected Looking Model".into(),
    }];
    let staged = state
        .stage_provider(setup, MillisSinceEpoch(1_000))
        .expect("provider stages");
    let platform = FakePlatform::ready("3.20.0");

    launch_import_with_platform(
        launch_env(&state, &platform, 2_000),
        valid_launch(&staged.receipt),
    )
    .expect("handoff launches");

    let opened = platform.opened().expect("fake opener saw URL");
    let parsed = Url::parse(&opened).expect("handoff URL parses");
    let api_key_count = parsed
        .query_pairs()
        .filter(|(key, _)| key == "apiKey")
        .count();
    let model = parsed
        .query_pairs()
        .find(|(key, _)| key == "model")
        .map(|(_, value)| value.into_owned());
    assert_eq!(api_key_count, 1);
    assert_eq!(model.as_deref(), Some("model&apiKey=bad"));
}

#[cfg(windows)]
#[test]
#[ignore = "manual QA: opens the installed CC Switch confirmation dialog"]
fn manual_windows_cold_start_opens_confirmation_after_preparing_cc_switch() {
    let state = CcSwitchSetupState::default();
    let mut setup = valid_setup("nonsecret-cold-start-probe");
    setup.provider_name = "YUME Cold Start Probe".into();
    let staged = state
        .stage_provider(setup, MillisSinceEpoch(1_000))
        .expect("provider stages");
    let platform = SystemCcSwitchPlatform;

    let receipt = launch_import_with_platform(
        LaunchEnvironment {
            state: &state,
            platform: &platform,
            now: MillisSinceEpoch(2_000),
        },
        valid_launch(&staged.receipt),
    )
    .expect("cold-start handoff launches");

    assert_eq!(receipt.provider_name, "YUME Cold Start Probe");
}
