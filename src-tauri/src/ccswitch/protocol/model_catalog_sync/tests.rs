mod support;

use std::fs;
use std::path::Path;

use super::*;
use crate::ccswitch::recovery::FileObservation;
use support::*;

#[test]
fn expands_only_the_generated_yume_provider_and_leaves_neighbours_byte_identical() {
    let original = document_with(vec![(YUME_ID.to_owned(), yume_provider(SELECTED))]);
    let home = Home::new(&original);

    let outcome = expand(&home, &full_catalog()).expect("expand catalog");

    assert_eq!(outcome.model_count, 4);
    assert!(outcome.ccswitch_sync_required);
    let updated = home.document();
    assert_eq!(
        model_ids(&updated, YUME_ID),
        vec!["claude-opus-5", "gpt-5.4-mini", "kimi-k3", "qwen3.8-max"]
    );
    for untouched in [
        "kuro",
        "omo-kuro",
        "omo-8b173b85-2a06-41ac-863e-3b9d9df198e0",
    ] {
        assert_eq!(
            provider_of(&updated, untouched),
            provider_of(&original, untouched),
            "{untouched} must not change"
        );
    }
    assert_eq!(updated.get("$schema"), original.get("$schema"));
    assert_eq!(updated.get("model"), original.get("model"));
    let options = provider_of(&updated, YUME_ID)
        .get("options")
        .and_then(Value::as_object)
        .expect("options object");
    let mut option_keys = options.keys().cloned().collect::<Vec<_>>();
    option_keys.sort();
    assert_eq!(option_keys, vec!["apiKey", "baseURL"]);
    assert_eq!(
        provider_of(&updated, YUME_ID).get("npm"),
        provider_of(&original, YUME_ID).get("npm")
    );
}

#[test]
fn picks_the_newest_generation_when_multiple_yume_providers_exist() {
    let newest = "yumeopencode-1788499999999";
    let home = Home::new(&document_with(vec![
        (YUME_ID.to_owned(), yume_provider(SELECTED)),
        (newest.to_owned(), yume_provider(SELECTED)),
    ]));

    expand(&home, &full_catalog()).expect("expand catalog");

    let updated = home.document();
    assert_eq!(model_ids(&updated, newest).len(), 4);
    assert_eq!(model_ids(&updated, YUME_ID), vec![SELECTED]);
}

#[test]
fn selected_model_is_always_present_after_expansion() {
    let home = Home::new(&document_with(vec![(
        YUME_ID.to_owned(),
        yume_provider(SELECTED),
    )]));

    expand(&home, &full_catalog()).expect("expand catalog");

    assert!(model_ids(&home.document(), YUME_ID).contains(&SELECTED.to_owned()));
}

#[test]
fn unrelated_provider_sharing_endpoint_and_model_is_never_touched() {
    let original = document_with(Vec::new());
    let home = Home::new(&original);

    let error = expand(&home, &full_catalog()).expect_err("no YUME provider");

    assert_eq!(error.code, "local_ai_model_catalog_provider_not_found");
    assert_eq!(home.document(), original);
}

#[test]
fn missing_verified_catalog_is_rejected_without_touching_the_file() {
    let original = document_with(vec![(YUME_ID.to_owned(), yume_provider(SELECTED))]);
    let home = Home::new(&original);

    let empty = ModelCatalog {
        base_url: ENDPOINT.to_owned(),
        api_key_fingerprint: "a".repeat(64),
        models: Vec::new(),
    };
    let error = expand(&home, &empty).expect_err("empty catalog");
    assert_eq!(error.code, "local_ai_model_catalog_missing");

    let without_selected = catalog(&["gpt-5.4-mini"]);
    let error = expand(&home, &without_selected).expect_err("catalog without selected model");
    assert_eq!(error.code, "local_ai_model_catalog_missing");
    assert_eq!(home.document(), original);
}

#[test]
fn concurrent_third_party_edit_aborts_the_write() {
    let home = Home::new(&document_with(vec![(
        YUME_ID.to_owned(),
        yume_provider(SELECTED),
    )]));
    let paths = home.paths();
    let observed = read_observed_file(&paths, OpenCodeFile::Config).expect("observe config");
    let stale = FileObservation::Present {
        sha256: "b".repeat(64),
    };

    let error =
        replace_file_if_unchanged(paths.home(), paths.config(), &stale, b"{\"provider\":{}}")
            .expect_err("stale write must abort");

    assert!(matches!(
        error,
        crate::ccswitch::recovery::RecoveryError::StaleConflict { .. }
    ));
    assert_eq!(
        read_observed_file(&paths, OpenCodeFile::Config)
            .expect("re-observe config")
            .observation,
        observed.observation
    );
}

#[test]
fn malformed_config_is_rejected_without_touching_the_file() {
    let home = Home::new(&document_with(vec![(
        YUME_ID.to_owned(),
        yume_provider(SELECTED),
    )]));
    fs::write(home.config_path(), b"{\"provider\": ").expect("write malformed config");

    let error = expand(&home, &full_catalog()).expect_err("malformed config");

    assert_eq!(error.code, "local_ai_model_catalog_write_failed");
    assert_eq!(home.raw(), b"{\"provider\": ");
}

#[test]
fn expansion_is_idempotent() {
    let home = Home::new(&document_with(vec![(
        YUME_ID.to_owned(),
        yume_provider(SELECTED),
    )]));

    let first = expand(&home, &full_catalog()).expect("first expansion");
    let after_first = home.raw();
    let second = expand(&home, &full_catalog()).expect("second expansion");

    assert_eq!(first, second);
    assert_eq!(after_first, home.raw());
}

#[test]
fn api_key_never_appears_in_error_debug_output() {
    let canary = format!("yume-redacted-{}", uuid::Uuid::new_v4());
    let mut provider = yume_provider(SELECTED);
    provider["options"]["apiKey"] = Value::String(canary.clone());
    let home = Home::new(&document_with(vec![(
        "yumeopencode-not-a-timestamp".to_owned(),
        provider,
    )]));

    let error = expand(&home, &full_catalog()).expect_err("no generated provider id");

    assert!(!format!("{error:?}").contains(&canary));
    assert!(!error.message.contains(&canary));
}

#[test]
fn untouched_documents_round_trip_byte_for_byte() {
    // Guards the assumption that lets us claim neighbours are unchanged:
    // serde_json's pretty printer reproduces cc-switch's own formatting.
    let original = document_with(vec![(YUME_ID.to_owned(), yume_provider(SELECTED))]);
    let home = Home::new(&original);
    let before = home.raw();

    let reserialized = serde_json::to_vec_pretty(&home.document()).expect("reserialize document");

    assert_eq!(before, reserialized);
    assert!(Path::new(&home.config_path()).is_file());
}
