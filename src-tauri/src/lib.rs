use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};

mod history;
mod settings;
mod updater;
mod window_layout;
use history::HistoryState;
use settings::{get_settings, set_settings, verify_api_key, SettingsState};

/// Sidecar state: the spawned `opencode serve` process and its base URL.
struct Sidecar {
    child: Mutex<Option<Child>>,
    port: u16,
}

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

#[tauri::command]
fn toggle_chat(app: tauri::AppHandle) -> Result<bool, String> {
    toggle_chat_impl(&app)
}

pub(crate) fn toggle_chat_impl(app: &tauri::AppHandle) -> Result<bool, String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    let shown = app.state::<ChatShown>();

    let explicitly_shown = *shown
        .0
        .lock()
        .map_err(|_| "chat state poisoned".to_string())?;
    let window_visible = chat.is_visible().map_err(|e| e.to_string())?;
    if should_hide_chat(explicitly_shown, window_visible) {
        hide_chat_impl(app)?;
        return Ok(false);
    }
    show_chat(app)?;
    Ok(true)
}

fn should_hide_chat(explicitly_shown: bool, window_visible: bool) -> bool {
    explicitly_shown && window_visible
}

fn should_restore_settings_focus(chat_was_shown: bool, settings_visible: bool) -> bool {
    chat_was_shown && settings_visible
}

#[tauri::command]
fn hide_chat(app: tauri::AppHandle) -> Result<(), String> {
    hide_chat_impl(&app)
}

#[tauri::command]
fn preview_pet_scale(app: tauri::AppHandle, scale: f64) {
    if let Some(pet) = app.get_webview_window("pet") {
        settings::apply_pet_scale(&pet, scale);
    }
}

pub(crate) fn hide_chat_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    chat.hide().map_err(|e| e.to_string())?;
    if let Some(shown) = app.try_state::<ChatShown>() {
        *shown
            .0
            .lock()
            .map_err(|_| "chat state poisoned".to_string())? = false;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{should_hide_chat, should_restore_settings_focus};

    #[test]
    fn stale_shown_state_does_not_hide_an_already_hidden_chat_window() {
        assert!(!should_hide_chat(true, false));
        assert!(should_hide_chat(true, true));
        assert!(!should_hide_chat(false, true));
    }

    #[test]
    fn visible_settings_window_reclaims_focus_after_chat_is_shown() {
        assert!(should_restore_settings_focus(true, true));
        assert!(!should_restore_settings_focus(true, false));
        assert!(!should_restore_settings_focus(false, true));
    }
}

/// Anchor the chat window next to the pet and bring it up (idempotent).
pub(crate) fn show_chat(app: &tauri::AppHandle) -> Result<(), String> {
    let pet = app.get_webview_window("pet").ok_or("pet window missing")?;
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    let shown = app.state::<ChatShown>();

    let pet_pos = pet.outer_position().map_err(|e| e.to_string())?;
    let pet_size = pet.outer_size().map_err(|e| e.to_string())?;
    let chat_scale = chat.scale_factor().map_err(|e| e.to_string())?;
    let chat_size = chat.outer_size().unwrap_or_else(|_| {
        tauri::PhysicalSize::new(
            (420.0 * chat_scale).round() as u32,
            (560.0 * chat_scale).round() as u32,
        )
    });
    let monitor = pet.current_monitor().ok().flatten();
    let (work_area, gap) = if let Some(monitor) = monitor {
        let area = monitor.work_area();
        (
            window_layout::Rect {
                x: i64::from(area.position.x),
                y: i64::from(area.position.y),
                width: i64::from(area.size.width),
                height: i64::from(area.size.height),
            },
            (8.0 * monitor.scale_factor()).round() as i64,
        )
    } else {
        (
            window_layout::Rect {
                x: i64::from(pet_pos.x) - 4096,
                y: i64::from(pet_pos.y) - 4096,
                width: 8192,
                height: 8192,
            },
            (8.0 * chat_scale).round() as i64,
        )
    };
    let point = window_layout::position_chat(
        window_layout::Rect {
            x: i64::from(pet_pos.x),
            y: i64::from(pet_pos.y),
            width: i64::from(pet_size.width),
            height: i64::from(pet_size.height),
        },
        window_layout::Size {
            width: i64::from(chat_size.width),
            height: i64::from(chat_size.height),
        },
        work_area,
        gap,
    );
    chat.set_position(tauri::PhysicalPosition::new(
        point.x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        point.y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    ))
    .map_err(|e| e.to_string())?;
    chat.show().map_err(|e| e.to_string())?;
    chat.set_focus().map_err(|e| e.to_string())?;
    *shown
        .0
        .lock()
        .map_err(|_| "chat state poisoned".to_string())? = true;
    restore_settings_focus_if_visible(app);
    Ok(())
}

/// Resolve the opencode binary: bundled resources first, then npm global, then PATH.
fn resolve_opencode(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("resources").join("opencode").join("opencode.exe");
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
    use std::time::{Duration, Instant};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Only matches opencode processes spawned by us: our sidecar is the only
    // one passing `--cors http://tauri.localhost` on its command line.
    let script = "Get-CimInstance Win32_Process -Filter \"Name = 'opencode.exe'\" | Where-Object { $_.CommandLine -match 'tauri\\.localhost' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    let Ok(mut child) = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    else {
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
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
    for src in candidates {
        if src.exists() {
            let _ = copy_missing_dir_recursive(&src, &dst);
            return;
        }
    }
}

fn copy_missing_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if target.exists() {
            continue;
        }
        if entry.file_type()?.is_dir() {
            copy_missing_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn spawn_sidecar(app: &tauri::AppHandle, port: u16) -> std::io::Result<Child> {
    let data_dir = app.path().app_data_dir().expect("app data dir unavailable");
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
        let _ = hide_chat_impl(app);
    } else {
        let _ = pet.show();
    }
}

fn show_settings_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        return;
    };
    let _ = win.set_always_on_top(true);
    let _ = win.center();
    let _ = win.show();
    let _ = win.set_focus();
}

fn restore_settings_focus_if_visible(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        return;
    };
    let Ok(settings_visible) = win.is_visible() else {
        return;
    };
    if !should_restore_settings_focus(true, settings_visible) {
        return;
    }
    let _ = win.set_always_on_top(true);
    let _ = win.show();
    let _ = win.set_focus();
}

/// Frontend close button: move offscreen instead of hide, so IPC stays alive.
#[tauri::command]
fn hide_settings(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_always_on_top(false);
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
            hide_chat,
            preview_pet_scale,
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
                } else {
                    let _ = pet.show();
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
