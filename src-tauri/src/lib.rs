use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};

mod history;
mod settings;
mod updater;
use history::HistoryState;
use settings::{get_settings, set_settings, verify_api_key, SettingsState};

/// Sidecar state: the spawned `opencode serve` process and its base URL.
struct Sidecar {
    child: Mutex<Option<Child>>,
    port: u16,
}

/// Whether the chat window is currently presented to the user.
/// (The window itself stays "visible" offscreen at startup so that WebView2
/// finishes initializing; a window created hidden never boots its IPC.)
struct ChatShown(Mutex<bool>);

#[tauri::command]
fn sidecar_base_url(sidecar: State<Sidecar>) -> String {
    format!("http://127.0.0.1:{}", sidecar.port)
}

/// Load the persona system prompt + placeholders from the app data dir.
#[tauri::command]
fn load_persona(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    // Reject path-traversal persona ids.
    if id.contains(['/', '\\', '.']) {
        return Err("invalid persona id".into());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = data_dir.join("personas").join(&id);
    let persona = std::fs::read_to_string(dir.join("persona.md")).map_err(|e| e.to_string())?;
    let placeholders = std::fs::read_to_string(dir.join("placeholders.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    Ok(serde_json::json!({ "persona": persona, "placeholders": placeholders }))
}

/// Toggle the chat window: anchor it next to the pet, then show/hide.
/// Uses an explicit shown-state instead of `is_visible` because the chat
/// window starts visible-but-offscreen (see `ChatShown`).
#[tauri::command]
fn toggle_chat(app: tauri::AppHandle) -> Result<bool, String> {
    toggle_chat_impl(&app)
}

pub(crate) fn toggle_chat_impl(app: &tauri::AppHandle) -> Result<bool, String> {
    let chat = app.get_webview_window("chat").ok_or("chat window missing")?;
    let shown = app.state::<ChatShown>();

    let mut is_shown = shown.0.lock().unwrap();
    if *is_shown {
        chat.hide().map_err(|e| e.to_string())?;
        *is_shown = false;
        return Ok(false);
    }
    drop(is_shown);
    show_chat(app)?;
    Ok(true)
}

/// Anchor the chat window next to the pet and bring it up (idempotent).
pub(crate) fn show_chat(app: &tauri::AppHandle) -> Result<(), String> {
    const CHAT_W: f64 = 420.0;
    const CHAT_GAP: f64 = 8.0;

    let pet = app.get_webview_window("pet").ok_or("pet window missing")?;
    let chat = app.get_webview_window("chat").ok_or("chat window missing")?;
    let shown = app.state::<ChatShown>();

    let pos = pet.outer_position().map_err(|e| e.to_string())?;
    let size = pet.outer_size().map_err(|e| e.to_string())?;
    let scale = pet.scale_factor().map_err(|e| e.to_string())?;
    let logical: tauri::LogicalPosition<f64> = pos.to_logical(scale);
    let pet_w = size.to_logical::<f64>(scale).width;
    // Prefer the left side of the pet; fall back to the right when the pet
    // sits near the left screen edge.
    let x = if logical.x - CHAT_W - CHAT_GAP >= 0.0 {
        logical.x - CHAT_W - CHAT_GAP
    } else {
        logical.x + pet_w + CHAT_GAP
    };
    chat.set_position(tauri::LogicalPosition::new(x, (logical.y - 140.0).max(0.0)))
        .map_err(|e| e.to_string())?;
    chat.show().map_err(|e| e.to_string())?;
    chat.set_focus().map_err(|e| e.to_string())?;
    *shown.0.lock().unwrap() = true;
    Ok(())
}

/// Resolve the opencode binary: bundled resources first, then platform-specific
/// package-manager locations, then PATH.
fn resolve_opencode(app: &tauri::AppHandle) -> PathBuf {
    let executable = if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    };

    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("resources").join("opencode").join(executable);
        if bundled.exists() {
            return bundled;
        }
    }

    // npm global install ships a real .exe next to the shim.
    if let Ok(appdata) = std::env::var("APPDATA") {
        let npm = PathBuf::from(appdata)
            .join("npm")
            .join("node_modules")
            .join("opencode-ai")
            .join("bin")
            .join("opencode.exe");
        if npm.exists() {
            return npm;
        }
    }

    // Apps opened from Finder do not inherit the interactive shell PATH, so
    // probe the standard Homebrew and user-level install locations on macOS.
    #[cfg(target_os = "macos")]
    {
        for path in [
            PathBuf::from("/opt/homebrew/bin/opencode"),
            PathBuf::from("/usr/local/bin/opencode"),
        ] {
            if path.exists() {
                return path;
            }
        }

        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            for relative in [
                ".opencode/bin/opencode",
                ".local/bin/opencode",
                ".bun/bin/opencode",
                "bin/opencode",
            ] {
                let path = home.join(relative);
                if path.exists() {
                    return path;
                }
            }
        }
    }

    PathBuf::from("opencode")
}

fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("no free port available")
}

/// Kill orphaned `opencode serve` sidecars from previous runs.
#[cfg(windows)]
fn cleanup_orphan_sidecars() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Only matches opencode processes spawned by us: our sidecar is the only
    // one passing `--cors http://tauri.localhost` on its command line.
    let script = "Get-CimInstance Win32_Process -Filter \"Name = 'opencode.exe'\" | Where-Object { $_.CommandLine -match 'tauri\\.localhost' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    let _ = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

/// Copy ship resources (personas) into the app data dir on first run,
/// so users can edit them without touching the install dir.
fn sync_ship_resources(app: &tauri::AppHandle, data_dir: &PathBuf) {
    let Ok(res_dir) = app.path().resource_dir() else {
        return;
    };
    let candidates = [
        res_dir.join("resources").join("personas"),
        res_dir.join("personas"),
    ];
    let dst = data_dir.join("personas");
    if dst.exists() {
        return;
    }
    for src in candidates {
        if src.exists() {
            let _ = copy_dir_recursive(&src, &dst);
            return;
        }
    }
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn spawn_sidecar(app: &tauri::AppHandle, port: u16) -> std::io::Result<Child> {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("app data dir unavailable");
    std::fs::create_dir_all(&data_dir)?;
    sync_ship_resources(app, &data_dir);

    // Sessions live in a dedicated workspace dir under app data.
    let workspace = data_dir.join("workspace");
    std::fs::create_dir_all(&workspace)?;

    let bin = resolve_opencode(app);
    let mut cmd = Command::new(&bin);
    cmd.arg("serve")
        .arg("--port")
        .arg(port.to_string())
        .arg("--hostname")
        .arg("127.0.0.1")
        // Production WebView origin on Windows is http://tauri.localhost;
        // localhost dev origins are allowed by default.
        .arg("--cors")
        .arg("http://tauri.localhost")
        .arg("--cors")
        .arg("tauri://localhost")
        .arg("--print-logs")
        .current_dir(&workspace)
        // NOTE: we intentionally reuse the user's global opencode config +
        // auth store so model credentials work out of the box. The persona
        // is injected per-message via the `system` prompt field instead.
        .env_remove("OPENCODE_SERVER_PASSWORD")
        .env_remove("OPENCODE_SERVER_USERNAME");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let log_path = data_dir.join("sidecar.log");
    if let Ok(log) = std::fs::File::create(&log_path) {
        if let Ok(log_err) = log.try_clone() {
            cmd.stdout(log).stderr(log_err);
        }
    }

    cmd.spawn()
}

/// Build the system tray: left-click toggles the pet, menu has show/hide + quit.
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_hide = MenuItem::with_id(app, "toggle_pet", "显示/隐藏桌宠", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_hide, &open_settings, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundled icon").clone())
        .tooltip("deskmate - 小碟")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_pet" => toggle_pet_visibility(app),
            "settings" => show_settings_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_pet_visibility(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Show/hide the pet; hiding the pet also hides the chat window.
pub(crate) fn toggle_pet_visibility(app: &tauri::AppHandle) {
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };
    let visible = pet.is_visible().unwrap_or(true);
    if visible {
        let _ = pet.hide();
        if let Some(chat) = app.get_webview_window("chat") {
            let _ = chat.hide();
        }
        if let Some(shown) = app.try_state::<ChatShown>() {
            *shown.0.lock().unwrap() = false;
        }
    } else {
        let _ = pet.show();
    }
}

/// Bring the settings window on-screen, centered. Like the chat window it is
/// created visible-but-offscreen so its WebView IPC boots reliably.
fn show_settings_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        return;
    };
    let _ = win.center();
    let _ = win.show();
    let _ = win.set_focus();
}

/// Frontend close button: move offscreen instead of hide, so IPC stays alive.
#[tauri::command]
fn hide_settings(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    show_settings_window(&app);
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Kill orphaned `opencode serve` sidecars left behind by force-killed
    // previous runs (identified by our unique `--cors http://tauri.localhost`
    // marker). Runs synchronously BEFORE spawning the new sidecar so the
    // fresh one is never targeted.
    #[cfg(windows)]
    cleanup_orphan_sidecars();

    let port = pick_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Sidecar {
            child: Mutex::new(None),
            port,
        })
        .manage(ChatShown(Mutex::new(false)))
        .invoke_handler(tauri::generate_handler![
            sidecar_base_url,
            load_persona,
            toggle_chat,
            get_settings,
            set_settings,
            verify_api_key,
            open_settings,
            hide_settings,
            app_version,
            history::history_list,
            history::history_load,
            history::history_save,
            history::history_delete,
            updater::update_app
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Load persisted settings and apply startup side-effects.
            let loaded = settings::load(&handle);
            settings::register_shortcuts(&handle, &loaded);
            if let Some(pet) = app.get_webview_window("pet") {
                if !loaded.pet_visible {
                    let _ = pet.hide();
                }
                if !loaded.always_on_top {
                    let _ = pet.set_always_on_top(false);
                }
                if (loaded.pet_scale - 1.0).abs() > f64::EPSILON {
                    settings::apply_pet_scale(&pet, loaded.pet_scale);
                }
            }
            app.manage(SettingsState(Mutex::new(loaded)));
            app.manage(HistoryState(Mutex::new(history::load(&handle))));
            settings::start_scheduler(handle.clone());

            setup_tray(&handle)?;
            match spawn_sidecar(&handle, port) {
                Ok(child) => {
                    *app.state::<Sidecar>().child.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("failed to spawn opencode sidecar: {e}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Sidecar>().child.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
