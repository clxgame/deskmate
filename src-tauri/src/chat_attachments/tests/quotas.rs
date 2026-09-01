use super::{stage_request, AttachmentStore, TempAttachmentRoot, MIB};

#[test]
fn enforces_ordinary_item_and_aggregate_budget_boundaries() {
    let root = TempAttachmentRoot::new("ordinary-budget");
    let store = AttachmentStore::default();

    store
        .stage(
            root.path(),
            stage_request("single", "exact.bin", "text/plain", vec![1; 20 * MIB]),
        )
        .expect("exact 20 MiB ordinary item should pass");
    assert!(store
        .stage(
            root.path(),
            stage_request("too-big", "large.bin", "text/plain", vec![1; 20 * MIB + 1],),
        )
        .expect_err("ordinary item over 20 MiB must fail")
        .to_string()
        .contains("20 MiB"));

    store
        .stage(
            root.path(),
            stage_request("aggregate", "a.bin", "text/plain", vec![1; 12 * MIB]),
        )
        .expect("first aggregate item");
    store
        .stage(
            root.path(),
            stage_request("aggregate", "b.bin", "text/plain", vec![1; 8 * MIB]),
        )
        .expect("exact 20 MiB ordinary aggregate should pass");
    assert!(store
        .stage(
            root.path(),
            stage_request("aggregate", "c.bin", "text/plain", vec![1]),
        )
        .expect_err("ordinary aggregate over 20 MiB must fail")
        .to_string()
        .contains("20 MiB"));
}

#[test]
fn enforces_ncm_item_and_total_staged_budget_boundaries() {
    let root = TempAttachmentRoot::new("ncm-budget");
    let store = AttachmentStore::default();

    store
        .stage(
            root.path(),
            stage_request(
                "ncm-single",
                "song.ncm",
                "application/x-ncm",
                vec![1; 64 * MIB],
            ),
        )
        .expect("exact 64 MiB NCM item should pass");
    assert!(store
        .stage(
            root.path(),
            stage_request(
                "ncm-too-big",
                "song.ncm",
                "application/x-ncm",
                vec![1; 64 * MIB + 1],
            ),
        )
        .expect_err("NCM item over 64 MiB must fail")
        .to_string()
        .contains("64 MiB"));
    assert!(store
        .stage(
            root.path(),
            stage_request("ncm-single", "extra.txt", "text/plain", vec![1]),
        )
        .expect_err("total staged bytes over 64 MiB must fail")
        .to_string()
        .contains("64 MiB"));
}
