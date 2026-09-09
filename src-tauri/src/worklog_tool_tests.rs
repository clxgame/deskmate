fn owned_worklog_resources() -> [(&'static str, &'static [u8]); 6] {
    [
        (
            "worklog_record.ts",
            include_bytes!("../resources/opencode-tools/worklog_record.ts").as_slice(),
        ),
        (
            "worklog_query.ts",
            include_bytes!("../resources/opencode-tools/worklog_query.ts").as_slice(),
        ),
        (
            "worklog_update.ts",
            include_bytes!("../resources/opencode-tools/worklog_update.ts").as_slice(),
        ),
        (
            "worklog_generate_report.ts",
            include_bytes!("../resources/opencode-tools/worklog_generate_report.ts").as_slice(),
        ),
        (
            "worklog_schedule_report.ts",
            include_bytes!("../resources/opencode-tools/worklog_schedule_report.ts").as_slice(),
        ),
        (
            "../worklog-bridge.ts",
            include_bytes!("../resources/worklog-bridge.ts").as_slice(),
        ),
    ]
}

fn complete_shipped_worklog_fixture(root: &std::path::Path) -> std::path::PathBuf {
    let tools = root.join("shipped").join("opencode-tools");
    std::fs::create_dir_all(&tools).expect("fixture resources");
    for (name, bytes) in owned_worklog_resources() {
        std::fs::write(tools.join(name), bytes).expect("write shipped fixture");
    }
    tools
}

fn runtime_worklog_target(config: &std::path::Path, name: &str) -> std::path::PathBuf {
    if name == "../worklog-bridge.ts" {
        config.join("worklog-bridge.ts")
    } else {
        config.join("tools").join(name)
    }
}

#[test]
fn worklog_tool_sync_overwrites_only_owned_complete_fixture() {
    let root = std::env::temp_dir().join(format!("worklog-tool-sync-{}", uuid::Uuid::new_v4()));
    let tools = complete_shipped_worklog_fixture(&root);
    let data = root.join("data");
    let config = data.join("workspace").join(".opencode");
    let runtime = config.join("tools");
    std::fs::create_dir_all(&runtime).expect("fixture runtime");
    std::fs::write(runtime.join("worklog_query.ts"), "stale query").expect("stale query");
    std::fs::write(config.join("worklog-bridge.ts"), "stale bridge").expect("stale bridge");
    std::fs::write(
        runtime.join("ccswitch_prepare_opencode_provider.ts"),
        "sentinel",
    )
    .expect("unrelated fixture");

    super::overwrite_worklog_tools(&tools, &data).expect("refresh worklog tools");

    for (name, expected) in owned_worklog_resources() {
        assert_eq!(
            std::fs::read(runtime_worklog_target(&config, name)).expect("read refreshed tool"),
            expected
        );
    }
    assert_eq!(
        std::fs::read_to_string(runtime.join("ccswitch_prepare_opencode_provider.ts"))
            .expect("read sentinel"),
        "sentinel"
    );
    println!(
        "runtime_refresh temp_root={} byte_compare=all_owned sentinel=preserved",
        root.display()
    );
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn worklog_query_tool_contract_covers_natural_recall_shape() {
    let source = include_str!("../resources/opencode-tools/worklog_query.ts");

    for marker in [
        "natural self-work recall",
        "direct current-turn request",
        "start and end dates",
        "{ entries, reports }",
        "Before updating",
    ] {
        assert!(source.contains(marker), "missing marker: {marker}");
    }
}

#[test]
fn worklog_tool_integrity_failure_removes_only_owned_tools() {
    let root =
        std::env::temp_dir().join(format!("worklog-tool-integrity-{}", uuid::Uuid::new_v4()));
    let tools = root.join("shipped").join("tools");
    let data = root.join("data");
    let runtime = data.join("workspace").join(".opencode").join("tools");
    std::fs::create_dir_all(&tools).expect("fixture resources");
    std::fs::create_dir_all(&runtime).expect("fixture runtime");
    std::fs::write(tools.join("worklog_record.ts"), "corrupted").expect("corrupt fixture");
    std::fs::write(runtime.join("worklog_record.ts"), "stale").expect("stale fixture");
    std::fs::write(
        runtime.join("ccswitch_prepare_opencode_provider.ts"),
        "sentinel",
    )
    .expect("unrelated fixture");
    assert_eq!(
        super::overwrite_worklog_tools(&tools, &data)
            .expect_err("must reject corruption")
            .kind(),
        std::io::ErrorKind::InvalidData
    );
    assert!(!runtime.join("worklog_record.ts").exists());
    assert_eq!(
        std::fs::read_to_string(runtime.join("ccswitch_prepare_opencode_provider.ts"))
            .expect("read sentinel"),
        "sentinel"
    );
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn worklog_tool_missing_resource_fails_closed() {
    let root = std::env::temp_dir().join(format!("worklog-tool-missing-{}", uuid::Uuid::new_v4()));
    let tools = complete_shipped_worklog_fixture(&root);
    let data = root.join("data");
    let config = data.join("workspace").join(".opencode");
    let runtime = config.join("tools");
    std::fs::create_dir_all(&runtime).expect("fixture runtime");
    std::fs::write(runtime.join("worklog_query.ts"), "stale query").expect("stale query");
    std::fs::write(config.join("worklog-bridge.ts"), "stale bridge").expect("stale bridge");
    std::fs::write(
        runtime.join("ccswitch_prepare_opencode_provider.ts"),
        "sentinel",
    )
    .expect("unrelated fixture");
    std::fs::remove_file(tools.join("worklog_query.ts")).expect("remove shipped query");

    assert_eq!(
        super::overwrite_worklog_tools(&tools, &data)
            .expect_err("must reject missing resource")
            .kind(),
        std::io::ErrorKind::NotFound
    );
    assert!(!runtime.join("worklog_query.ts").exists());
    assert!(!config.join("worklog-bridge.ts").exists());
    assert_eq!(
        std::fs::read_to_string(runtime.join("ccswitch_prepare_opencode_provider.ts"))
            .expect("read sentinel"),
        "sentinel"
    );
    println!(
        "missing_resource temp_root={} stale_owned=removed sentinel=preserved",
        root.display()
    );
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}
