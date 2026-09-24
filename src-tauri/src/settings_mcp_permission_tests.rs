#[test]
fn derives_the_exact_fixed_qa_mcp_tool_id() {
    // The QA fixture is registered under the underscore config key
    // "yume_qa_mcp", matching the runtime-observed model tool ID.
    assert_eq!(
        super::mcp_tool_permission_id("yume_qa_mcp", "yume_qa_echo"),
        "yume_qa_mcp_yume_qa_echo"
    );
}

#[test]
fn sanitizes_non_alphanumeric_characters_in_both_segments() {
    assert_eq!(
        super::mcp_tool_permission_id("server.name with/slash", "tool.name with/slash"),
        "server_name_with_slash_tool_name_with_slash"
    );
}

#[test]
fn preserves_hyphens_like_upstream_sanitize() {
    // Upstream `sanitize` keeps '-': catalog.ts `[^a-zA-Z0-9_-]` -> "_".
    assert_eq!(
        super::mcp_tool_permission_id("my-server", "my-tool"),
        "my-server_my-tool"
    );
}

#[test]
fn default_policy_with_empty_approved_list_is_identical_to_baseline() {
    assert_eq!(
        super::sidecar_permission_policy_with_approved_mcp_tools(&[]),
        super::sidecar_permission_policy()
    );
}

#[test]
fn native_workbench_tools_are_visible_without_bypassing_approval() {
    // Given the global default-deny sidecar policy, When native workbench tools
    // are resolved, Then they remain model-visible but require approval.
    let permission = super::sidecar_permission_policy();
    for tool in ["edit", "write", "patch", "task", "question"] {
        assert_eq!(permission.get(tool), Some(&serde_json::json!("ask")));
    }
    assert_eq!(
        permission.get("external_directory"),
        Some(&serde_json::json!("deny"))
    );
    assert_eq!(permission.get("*"), Some(&serde_json::json!("deny")));
}

#[test]
fn approved_mcp_tool_gets_ask_and_unrelated_tool_stays_denied() {
    let permission = super::sidecar_permission_policy_with_approved_mcp_tools(&[(
        "yume_qa_mcp",
        "yume_qa_echo",
    )]);

    assert_eq!(
        permission.get("yume_qa_mcp_yume_qa_echo"),
        Some(&serde_json::json!("ask"))
    );
    assert!(!permission.contains_key("yume_qa_mcp_yume_qa_echo_unapproved"));
    assert_eq!(permission.get("*"), Some(&serde_json::json!("deny")));
}

#[test]
fn desktop_mcp_defaults_to_disabled_and_keeps_the_baseline_policy() {
    let settings = super::Settings::default();
    let mut config = serde_json::Map::new();
    super::configure_desktop_mcp(
        &mut config,
        &settings,
        Some(std::path::Path::new("C:/tools/npx.cmd")),
        Some(std::path::Path::new(
            "C:/app/windows-mcp/Sbroenne.WindowsMcp.exe",
        )),
        std::path::Path::new("C:/app/mcp-output"),
    );
    assert!(!config.contains_key("mcp"));
    assert_eq!(
        config["permission"],
        serde_json::Value::Object(super::sidecar_permission_policy())
    );
}

#[test]
fn enabled_desktop_mcp_servers_are_pinned_minimal_and_ask_gated() {
    let settings = super::Settings {
        browser_mcp_enabled: true,
        windows_mcp_enabled: true,
        ..super::Settings::default()
    };
    let mut config = serde_json::Map::new();
    super::configure_desktop_mcp(
        &mut config,
        &settings,
        Some(std::path::Path::new("C:/tools/npx.cmd")),
        Some(std::path::Path::new(
            "C:/app/windows-mcp/Sbroenne.WindowsMcp.exe",
        )),
        std::path::Path::new("C:/app/mcp-output"),
    );
    let mcp = config["mcp"].as_object().expect("mcp map");
    let playwright_command = mcp["yume_playwright"]["command"]
        .as_array()
        .expect("playwright command");
    assert!(playwright_command
        .iter()
        .any(|value| value == "@playwright/mcp@0.0.82"));
    assert!(playwright_command.iter().any(|value| value == "--isolated"));
    assert!(playwright_command.iter().any(|value| value == "--headless"));
    let windows_command = mcp["yume_windows"]["command"]
        .as_array()
        .expect("windows command");
    assert_eq!(
        windows_command[0],
        "C:/app/windows-mcp/Sbroenne.WindowsMcp.exe"
    );
    assert!(windows_command.iter().any(|value| value == "--tools"));
    assert!(windows_command.iter().any(|value| value
        .as_str()
        .is_some_and(|tools| tools.contains("screenshot_control"))));
    let permission = config["permission"].as_object().expect("permission map");
    for id in [
        "yume_playwright_browser_navigate",
        "yume_playwright_browser_fill_form",
        "yume_windows_app",
        "yume_windows_ui_type",
        "yume_windows_keyboard_control",
    ] {
        assert_eq!(permission.get(id), Some(&serde_json::json!("ask")));
    }
    assert!(!permission.contains_key("yume_windows_process"));
    assert!(!permission.contains_key("yume_windows_clipboard"));
    assert_eq!(permission.get("*"), Some(&serde_json::json!("deny")));
}

#[test]
fn desktop_mcp_survives_when_no_ai_provider_is_verified() {
    let settings = super::Settings {
        windows_mcp_enabled: true,
        ..super::Settings::default()
    };
    let (config, auth) = super::baseline_sidecar_environment();
    let mut config = serde_json::from_str::<serde_json::Value>(&config)
        .expect("baseline config")
        .as_object()
        .expect("baseline config object")
        .clone();

    super::configure_desktop_mcp(
        &mut config,
        &settings,
        None,
        Some(std::path::Path::new(
            "C:/app/windows-mcp/Sbroenne.WindowsMcp.exe",
        )),
        std::path::Path::new("C:/app/mcp-output"),
    );

    assert_eq!(auth, "{}");
    assert_eq!(config["mcp"]["yume_windows"]["enabled"], true);
    assert_eq!(config["permission"]["yume_windows_ui_type"], "ask");
}
