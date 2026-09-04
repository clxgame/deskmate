use super::support::*;
use serde_json::Value;

/// The deep link mints a fresh `<name>-<millis>` provider on every deployment and
/// cc-switch never deduplicates, so `opencode.json` accumulates one dead entry
/// per run. Pruning happens in the same atomic write as the expansion.
#[test]
fn superseded_yume_providers_are_pruned_in_the_same_write() {
    let stale_old = "yumeopencode-1788493686070";
    let stale_mid = "yumeopencode-1788507024529";
    let newest = "yumeopencode-1788507103258";
    let original = document_with(vec![
        (stale_old.to_owned(), yume_provider(SELECTED)),
        (stale_mid.to_owned(), yume_provider(SELECTED)),
        (newest.to_owned(), yume_provider(SELECTED)),
    ]);
    let home = Home::new(&original);

    let outcome = expand(&home, &full_catalog()).expect("expand catalog");

    assert_eq!(outcome.model_count, 4);
    assert_eq!(outcome.superseded_removed, 2);
    let updated = home.document();
    let providers = updated
        .get("provider")
        .and_then(Value::as_object)
        .expect("provider object");
    assert!(providers.contains_key(newest), "newest must survive");
    assert!(!providers.contains_key(stale_old), "stale must be pruned");
    assert!(!providers.contains_key(stale_mid), "stale must be pruned");
    assert_eq!(model_ids(&updated, newest).len(), 4);
}

#[test]
fn pruning_never_touches_providers_yume_does_not_own() {
    let stale = "yumeopencode-1788493686070";
    let newest = "yumeopencode-1788507103258";
    let original = document_with(vec![
        (stale.to_owned(), yume_provider(SELECTED)),
        (newest.to_owned(), yume_provider(SELECTED)),
    ]);
    let home = Home::new(&original);

    expand(&home, &full_catalog()).expect("expand catalog");

    let updated = home.document();
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
}

/// A generated id that points at a different gateway is somebody else's import,
/// even though it shares YUME's provider name. Leave it alone.
#[test]
fn generated_providers_on_a_different_endpoint_are_left_alone() {
    let foreign = "yumeopencode-1788400000000";
    let mut foreign_provider = yume_provider(SELECTED);
    foreign_provider["options"]["baseURL"] = Value::String("https://other.example.test".to_owned());
    let newest = "yumeopencode-1788507103258";
    let home = Home::new(&document_with(vec![
        (foreign.to_owned(), foreign_provider),
        (newest.to_owned(), yume_provider(SELECTED)),
    ]));

    let outcome = expand(&home, &full_catalog()).expect("expand catalog");

    assert_eq!(outcome.superseded_removed, 0);
    let updated = home.document();
    assert!(updated
        .get("provider")
        .and_then(Value::as_object)
        .expect("provider object")
        .contains_key(foreign));
}

#[test]
fn a_single_provider_deployment_prunes_nothing() {
    let home = Home::new(&document_with(vec![(
        YUME_ID.to_owned(),
        yume_provider(SELECTED),
    )]));

    let outcome = expand(&home, &full_catalog()).expect("expand catalog");

    assert_eq!(outcome.superseded_removed, 0);
    assert_eq!(model_ids(&home.document(), YUME_ID).len(), 4);
}

#[test]
fn pruning_is_idempotent_across_repeated_runs() {
    let home = Home::new(&document_with(vec![
        ("yumeopencode-1788493686070".to_owned(), yume_provider(SELECTED)),
        ("yumeopencode-1788507103258".to_owned(), yume_provider(SELECTED)),
    ]));

    let first = expand(&home, &full_catalog()).expect("first expansion");
    let after_first = home.raw();
    let second = expand(&home, &full_catalog()).expect("second expansion");

    assert_eq!(first.superseded_removed, 1);
    assert_eq!(second.superseded_removed, 0);
    assert_eq!(first.model_count, second.model_count);
    assert_eq!(after_first, home.raw());
}

/// Pruning must not strand the model the deployment just verified.
#[test]
fn the_surviving_provider_still_carries_the_selected_model() {
    let home = Home::new(&document_with(vec![
        ("yumeopencode-1788493686070".to_owned(), yume_provider(SELECTED)),
        ("yumeopencode-1788507103258".to_owned(), yume_provider(SELECTED)),
    ]));

    expand(&home, &full_catalog()).expect("expand catalog");

    assert!(model_ids(&home.document(), "yumeopencode-1788507103258")
        .contains(&SELECTED.to_owned()));
}
