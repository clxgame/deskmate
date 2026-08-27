use super::launch::launch_import_with_platform;
use super::launch_fixture::{launch_env, valid_launch, valid_setup, FakePlatform};
use crate::ccswitch::contract::{CcSwitchSetupState, MillisSinceEpoch};

#[test]
fn fails_closed_without_confirmation_or_supported_handler_and_keeps_retryable_ticket() {
    let state = CcSwitchSetupState::default();
    let credential = format!("runtime-credential-{}", uuid::Uuid::new_v4());
    let staged = state
        .stage_provider(valid_setup(&credential), MillisSinceEpoch(1_000))
        .expect("provider stages");
    let mut launch = valid_launch(&staged.receipt);
    launch.accepted_process_argument_disclosure = false;
    let ready_platform = FakePlatform::ready("3.20.0");
    assert_eq!(
        launch_import_with_platform(launch_env(&state, &ready_platform, 2_000), launch)
            .err()
            .map(|error| error.code),
        Some("ccswitch_confirmation_required")
    );
    let missing_platform = FakePlatform::missing();
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &missing_platform, 2_000),
            valid_launch(&staged.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_missing_protocol")
    );
    let platform = FakePlatform::ready("3.20.0");
    assert!(launch_import_with_platform(
        launch_env(&state, &platform, 2_000),
        valid_launch(&staged.receipt)
    )
    .is_ok());
}

#[test]
fn incompatible_handler_version_is_rejected_before_ticket_consumption() {
    let state = CcSwitchSetupState::default();
    let credential = format!("runtime-credential-{}", uuid::Uuid::new_v4());
    let staged = state
        .stage_provider(valid_setup(&credential), MillisSinceEpoch(1_000))
        .expect("provider stages");

    let error = launch_import_with_platform(
        launch_env(&state, &FakePlatform::ready("3.19.9"), 2_000),
        valid_launch(&staged.receipt),
    )
    .expect_err("old handler is incompatible");

    assert_eq!(error.code, "ccswitch_incompatible_version");
    assert!(launch_import_with_platform(
        launch_env(&state, &FakePlatform::ready("3.20.0"), 2_000),
        valid_launch(&staged.receipt)
    )
    .is_ok());
}

#[test]
fn unknown_handler_version_is_rejected_without_consuming_or_exposing_ticket() {
    let state = CcSwitchSetupState::default();
    let staged = state
        .stage_provider(
            valid_setup(&format!("runtime-credential-{}", uuid::Uuid::new_v4())),
            MillisSinceEpoch(1_000),
        )
        .expect("provider stages");
    let unknown_platform = FakePlatform::unknown_version();

    let error = launch_import_with_platform(
        launch_env(&state, &unknown_platform, 2_000),
        valid_launch(&staged.receipt),
    )
    .expect_err("unknown handler version must fail closed");

    assert_eq!(error.code, "ccswitch_incompatible_version");
    assert!(unknown_platform.opened().is_none());
    assert!(launch_import_with_platform(
        launch_env(&state, &FakePlatform::ready("3.20.0"), 2_000),
        valid_launch(&staged.receipt)
    )
    .is_ok());
}

#[test]
fn consumes_secret_on_opener_failure_replay_expiry_and_stale_binding_fail_closed() {
    let state = CcSwitchSetupState::default();
    let credential = format!("runtime-credential-{}", uuid::Uuid::new_v4());
    let staged = state
        .stage_provider(valid_setup(&credential), MillisSinceEpoch(1_000))
        .expect("provider stages");
    let failing_platform = FakePlatform::failing_open("3.20.0");
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &failing_platform, 2_000),
            valid_launch(&staged.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_open_failed")
    );
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &FakePlatform::ready("3.20.0"), 2_000),
            valid_launch(&staged.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_ticket_missing")
    );

    let expired = state
        .stage_provider(
            valid_setup(&format!("runtime-credential-{}", uuid::Uuid::new_v4())),
            MillisSinceEpoch(1_000),
        )
        .expect("provider stages");
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &FakePlatform::ready("3.20.0"), 601_000),
            valid_launch(&expired.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_ticket_expired")
    );
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &FakePlatform::ready("3.20.0"), 602_000),
            valid_launch(&expired.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_ticket_missing")
    );

    let stale = state
        .stage_provider(
            valid_setup(&format!("runtime-credential-{}", uuid::Uuid::new_v4())),
            MillisSinceEpoch(1_000),
        )
        .expect("provider stages");
    let mut launch = valid_launch(&stale.receipt);
    launch.endpoint = "https://api.evil.test".into();
    let ready_platform = FakePlatform::ready("3.20.0");
    assert_eq!(
        launch_import_with_platform(launch_env(&state, &ready_platform, 2_000), launch)
            .err()
            .map(|error| error.code),
        Some("ccswitch_ticket_stale")
    );
    assert!(ready_platform.opened().is_none());
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &ready_platform, 2_000),
            valid_launch(&stale.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_ticket_missing")
    );
}

#[test]
fn wrong_model_destroys_ticket_before_corrected_replay() {
    let state = CcSwitchSetupState::default();
    let staged = state
        .stage_provider(
            valid_setup(&format!("runtime-credential-{}", uuid::Uuid::new_v4())),
            MillisSinceEpoch(1_000),
        )
        .expect("provider stages");
    let platform = FakePlatform::ready("3.20.0");
    let mut mismatched = valid_launch(&staged.receipt);
    mismatched.selected_model = "unknown-model".into();

    assert_eq!(
        launch_import_with_platform(launch_env(&state, &platform, 2_000), mismatched)
            .err()
            .map(|error| error.code),
        Some("ccswitch_invalid_model")
    );
    assert!(platform.opened().is_none());
    assert_eq!(
        launch_import_with_platform(
            launch_env(&state, &platform, 2_000),
            valid_launch(&staged.receipt)
        )
        .err()
        .map(|error| error.code),
        Some("ccswitch_ticket_missing")
    );
}

#[test]
fn cancel_removes_ticket_without_rendering_secret() {
    let state = CcSwitchSetupState::default();
    let canary = format!("runtime-credential-{}", uuid::Uuid::new_v4());
    let staged = state
        .stage_provider(valid_setup(&canary), MillisSinceEpoch(1_000))
        .expect("provider stages");

    state
        .cancel_ticket(&staged.receipt.ticket_id)
        .expect("cancel removes staged ticket");

    let error = launch_import_with_platform(
        launch_env(&state, &FakePlatform::ready("3.20.0"), 2_000),
        valid_launch(&staged.receipt),
    )
    .expect_err("cancelled ticket cannot launch");
    let serialized = serde_json::to_string(&error).expect("error serializes");
    assert!(!serialized.contains(&canary));
    assert_eq!(error.code, "ccswitch_ticket_missing");
}
