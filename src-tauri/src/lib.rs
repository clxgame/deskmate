// allow: SIZE_OK — legacy Tauri bootstrap root owns startup/resource wiring; this patch keeps the migration at that boundary.
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use tauri::{Emitter, Manager, RunEvent, State};

mod ai_usage;
pub mod ccswitch;
mod history;
/// Local memory: storage, policy, retrieval, and the frontend command surface.
mod memory;
/// User-installable persona packs imported from local `.dmpack` archives.
mod packs;
mod settings;
mod updater;
mod window_layout;
use ai_usage::fetch_ai_usage;
use history::HistoryState;
use settings::{get_settings, set_settings, verify_api_key, SettingsState};

/// Sidecar state: the spawned `opencode serve` process and its base URL.
struct Sidecar {
    child: Mutex<Option<Child>>,
    port: u16,
}

struct ChatShown(Mutex<bool>);

#[derive(Default)]
struct ChatMotion {
    target: Mutex<Option<window_layout::Point>>,
    worker_running: AtomicBool,
}

#[tauri::command]
fn sidecar_base_url(sidecar: State<Sidecar>) -> String {
    format!("http://127.0.0.1:{}", sidecar.port)
}

/// Load the persona system prompt + placeholders, preferring an installed pack.
#[tauri::command]
fn load_persona(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    let (persona, placeholders_raw, skills) = packs::persona_files(&app, &id)?;
    let placeholders = placeholders_raw
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or(serde_json::Value::Null);
    // Skills come from the owning pack's manifest, so a new pack can grant
    // abilities without changing this command.
    let skills = (!skills.is_empty()).then(|| skills.join("\n\n"));
    Ok(serde_json::json!({
        "persona": persona,
        "placeholders": placeholders,
        "skills": skills,
    }))
}

/// Skill file that grants ncm conversion. A persona may use `convert_ncm` only
/// when its owning pack declares this file and ships it.
const NCM_SKILL_FILE: &str = "ncmdump.md";

#[derive(serde::Serialize)]
struct ConvertedNcm {
    filename: String,
    mime: String,
    size: usize,
    #[serde(rename = "dataUrl")]
    data_url: String,
}

#[tauri::command]
fn convert_ncm(
    app: tauri::AppHandle,
    persona_id: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<ConvertedNcm, String> {
    // The ability is declared by the owning pack's manifest, so a future pack can
    // grant ncm conversion without editing this command.
    if !packs::persona_grants_skill(&app, &persona_id, NCM_SKILL_FILE) {
        return Err("当前角色没有 ncm 转换能力".into());
    }
    const MAX_NCM_BYTES: usize = 64 * 1024 * 1024;
    if bytes.is_empty() || bytes.len() > MAX_NCM_BYTES {
        return Err("NCM 文件必须在 1 B 至 64 MB 之间".into());
    }
    let source_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.to_ascii_lowercase().ends_with(".ncm"))
        .ok_or("无效的 NCM 文件名")?
        .to_string();
    let binary = resolve_ncmdump(&app).ok_or("客户端未找到内置 ncmdump")?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("ncmdump");
    std::fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let work_dir = cache.join(format!("{}-{nonce}", std::process::id()));
    std::fs::create_dir_all(&work_dir).map_err(|error| error.to_string())?;
    let result = (|| -> Result<ConvertedNcm, String> {
        let input = work_dir.join(source_name);
        let output_dir = work_dir.join("output");
        std::fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
        std::fs::write(&input, bytes).map_err(|error| error.to_string())?;

        let mut command = Command::new(&binary);
        command.arg(&input).arg("-o").arg(&output_dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let output = command.output().map_err(|_| "无法启动内置 ncmdump")?;
        if !output.status.success() {
            return Err("ncmdump 无法转换这个文件".into());
        }

        let mut converted = std::fs::read_dir(&output_dir)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                matches!(
                    path.extension()
                        .and_then(|extension| extension.to_str())
                        .map(|extension| extension.to_ascii_lowercase())
                        .as_deref(),
                    Some("mp3") | Some("flac")
                )
            })
            .collect::<Vec<_>>();
        converted.sort();
        let output_path = converted.first().ok_or("ncmdump 没有生成音频文件")?;
        let output_bytes = std::fs::read(output_path).map_err(|error| error.to_string())?;
        let extension = output_path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("mp3")
            .to_ascii_lowercase();
        let mime = if extension == "flac" {
            "audio/flac"
        } else {
            "audio/mpeg"
        };
        let output_name = output_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("converted-audio.mp3")
            .to_string();
        let data = base64::engine::general_purpose::STANDARD.encode(&output_bytes);
        Ok(ConvertedNcm {
            filename: output_name,
            mime: mime.to_string(),
            size: output_bytes.len(),
            data_url: format!("data:{mime};base64,{data}"),
        })
    })();
    let _ = std::fs::remove_dir_all(&work_dir);
    result
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

fn clear_chat_motion(app: &tauri::AppHandle) {
    if let Some(motion) = app.try_state::<Arc<ChatMotion>>() {
        if let Ok(mut target) = motion.target.lock() {
            *target = None;
        }
    }
}

#[tauri::command]
fn hide_chat(app: tauri::AppHandle) -> Result<(), String> {
    hide_chat_impl(&app)
}

#[tauri::command]
fn show_chat_window(app: tauri::AppHandle) -> Result<(), String> {
    show_chat(&app)
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
    clear_chat_motion(app);
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
    use super::{
        configure_sidecar_command, migrate_legacy_xiaozhu_intro, overwrite_builtin_xiaozhu_persona,
        should_follow_chat_on_window_event, should_hide_chat, should_restore_settings_focus,
    };
    use std::ffi::OsStr;
    use std::path::Path;
    use std::process::Command;
    use tauri::{PhysicalPosition, WindowEvent};

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

    #[test]
    fn moving_the_pet_repositions_the_visible_chat_window() {
        assert!(should_follow_chat_on_window_event(&WindowEvent::Moved(
            PhysicalPosition::new(1500, 700),
        )));
        assert!(!should_follow_chat_on_window_event(&WindowEvent::Focused(
            true,
        )));
    }

    #[test]
    fn yume_sidecar_disables_external_plugins() {
        let mut command = Command::new("opencode");
        configure_sidecar_command(&mut command, 47_891, Path::new("."));

        assert_eq!(command.get_args().next(), Some(OsStr::new("--pure")));
    }

    #[test]
    fn migrates_only_the_legacy_xiaozhu_intro() {
        let legacy_mid =
            "你好！我是**著名**当代游戏电子游戏音乐先锋——霄太郎，当然\\~您叫我**小著**就行。";
        let legacy_runtime =
            "你好！我是著名当代游戏电子游戏音乐先锋——霄太郎，当然~您叫我小著就行。";
        let legacy = "你好，栋梁！我是小著，一名游戏配乐师，我会把游戏里的音乐布置到游戏中，让它们自然地流动起来，并随着游戏的状态有机地连续播放。";

        let prompt = format!("---\nid: xiaozhu\n---\n\n# 我是谁\n\n{legacy_mid}\n\n其他自定义内容");
        let migrated = migrate_legacy_xiaozhu_intro(&prompt);

        assert_eq!(
            migrated.as_deref(),
            Some("---\nid: xiaozhu\n---\n\n# 我是谁\n\n你好！我是当代游戏电子游戏音乐先锋——小著。\n\n其他自定义内容")
        );

        let prompt =
            format!("---\nid: xiaozhu\n---\n\n# 我是谁\n\n{legacy_runtime}\n\n其他自定义内容");
        let migrated = migrate_legacy_xiaozhu_intro(&prompt);

        assert_eq!(
            migrated.as_deref(),
            Some("---\nid: xiaozhu\n---\n\n# 我是谁\n\n你好！我是当代游戏电子游戏音乐先锋——小著。\n\n其他自定义内容")
        );

        let prompt = format!("---\nid: xiaozhu\n---\n\n# 我是谁\n\n{legacy}\n\n其他自定义内容");
        let migrated = migrate_legacy_xiaozhu_intro(&prompt);

        assert_eq!(
            migrated.as_deref(),
            Some("---\nid: xiaozhu\n---\n\n# 我是谁\n\n你好！我是当代游戏电子游戏音乐先锋——小著。\n\n其他自定义内容")
        );
        assert!(migrate_legacy_xiaozhu_intro("没有旧文案").is_none());
        assert!(migrate_legacy_xiaozhu_intro(&format!("# 其他内容\n\n{legacy}")).is_none());
    }

    #[test]
    fn overwrites_builtin_xiaozhu_persona_when_runtime_copy_is_stale() {
        let root = std::env::temp_dir().join(format!("yume-xiaozhu-sync-{}", uuid::Uuid::new_v4()));
        let shipped_personas = root.join("shipped-personas");
        let data_dir = root.join("data");
        let shipped_persona = shipped_personas.join("xiaozhu").join("persona.md");
        let runtime_persona = data_dir.join("personas").join("xiaozhu").join("persona.md");

        std::fs::create_dir_all(shipped_persona.parent().expect("shipped parent"))
            .expect("create shipped directory");
        std::fs::create_dir_all(runtime_persona.parent().expect("runtime parent"))
            .expect("create runtime directory");
        std::fs::write(&shipped_persona, "new built-in persona").expect("write shipped persona");
        std::fs::write(&runtime_persona, "stale runtime persona").expect("write stale persona");

        overwrite_builtin_xiaozhu_persona(&shipped_personas, &data_dir)
            .expect("sync built-in persona");

        assert_eq!(
            std::fs::read_to_string(&runtime_persona).expect("read synchronized persona"),
            "new built-in persona"
        );
        std::fs::remove_dir_all(root).expect("remove test directory");
    }
}

fn should_follow_chat_on_window_event(event: &tauri::WindowEvent) -> bool {
    matches!(event, tauri::WindowEvent::Moved(_))
}

fn chat_target(app: &tauri::AppHandle) -> Result<tauri::PhysicalPosition<i32>, String> {
    let pet = app.get_webview_window("pet").ok_or("pet window missing")?;
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;

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
    Ok(tauri::PhysicalPosition::new(
        point.x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        point.y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    ))
}

fn reposition_chat(app: &tauri::AppHandle) -> Result<(), String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    chat.set_position(chat_target(app)?)
        .map_err(|e| e.to_string())
}

fn request_chat_reposition(app: &tauri::AppHandle) -> Result<(), String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    if !chat.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let target = chat_target(app)?;
    let motion = app.state::<Arc<ChatMotion>>().inner().clone();
    *motion
        .target
        .lock()
        .map_err(|_| "chat motion state poisoned".to_string())? = Some(window_layout::Point {
        x: i64::from(target.x),
        y: i64::from(target.y),
    });
    if !motion.worker_running.swap(true, Ordering::AcqRel) {
        spawn_chat_motion_worker(chat, motion);
    }
    Ok(())
}

fn spawn_chat_motion_worker(chat: tauri::WebviewWindow, motion: Arc<ChatMotion>) {
    std::thread::spawn(move || loop {
        let target = motion.target.lock().ok().and_then(|guard| *guard);
        let Some(target) = target else {
            motion.worker_running.store(false, Ordering::Release);
            if motion
                .target
                .lock()
                .map(|guard| guard.is_some())
                .unwrap_or(false)
                && !motion.worker_running.swap(true, Ordering::AcqRel)
            {
                continue;
            }
            break;
        };

        let current = chat
            .outer_position()
            .unwrap_or(tauri::PhysicalPosition::new(
                target.x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
                target.y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
            ));
        let next = window_layout::smooth_step(
            window_layout::Point {
                x: i64::from(current.x),
                y: i64::from(current.y),
            },
            target,
            0.28,
        );
        let next_position = tauri::PhysicalPosition::new(
            next.x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
            next.y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        );
        let _ = chat.set_position(next_position);
        if next == target {
            if let Ok(mut guard) = motion.target.lock() {
                if *guard == Some(target) {
                    *guard = None;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    });
}

fn reposition_visible_chat(app: &tauri::AppHandle) {
    let Some(chat) = app.get_webview_window("chat") else {
        return;
    };
    if chat.is_visible().unwrap_or(false) {
        let _ = request_chat_reposition(app);
    }
}

fn place_pet_bottom_right(pet: &tauri::WebviewWindow) {
    let (Ok(size), Ok(Some(monitor))) = (pet.outer_size(), pet.current_monitor()) else {
        return;
    };
    let area = monitor.work_area();
    let point = window_layout::position_pet_bottom_right(
        window_layout::Size {
            width: i64::from(size.width),
            height: i64::from(size.height),
        },
        window_layout::Rect {
            x: i64::from(area.position.x),
            y: i64::from(area.position.y),
            width: i64::from(area.size.width),
            height: i64::from(area.size.height),
        },
        16,
    );
    let _ = pet.set_position(tauri::PhysicalPosition::new(
        point.x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        point.y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    ));
}

/// Anchor the chat window next to the pet and bring it up (idempotent).
pub(crate) fn show_chat(app: &tauri::AppHandle) -> Result<(), String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    let shown = app.state::<ChatShown>();

    clear_chat_motion(app);
    reposition_chat(app)?;
    chat.show().map_err(|e| e.to_string())?;
    chat.set_focus().map_err(|e| e.to_string())?;
    *shown
        .0
        .lock()
        .map_err(|_| "chat state poisoned".to_string())? = true;
    restore_settings_focus_if_visible(app);
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

fn resolve_ncmdump(app: &tauri::AppHandle) -> Option<PathBuf> {
    let executable = if cfg!(windows) {
        "ncmdump.exe"
    } else {
        "ncmdump"
    };
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("resources").join("ncmdump").join(executable));
        candidates.push(dir.join("ncmdump").join(executable));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ncmdump")
            .join(executable),
    );
    candidates.into_iter().find(|path| path.is_file())
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

const CURRENT_XIAOZHU_INTRO: &str = "你好！我是当代游戏电子游戏音乐先锋——小著。";
const LEGACY_XIAOZHU_INTROS: &[&str] = &[
    "你好！我是**著名**当代游戏电子游戏音乐先锋——霄太郎，当然\\~您叫我**小著**就行。",
    "你好！我是著名当代游戏电子游戏音乐先锋——霄太郎，当然~您叫我小著就行。",
    "你好，栋梁！我是小著，一名游戏配乐师，我会把游戏里的音乐布置到游戏中，让它们自然地流动起来，并随着游戏的状态有机地连续播放。",
];

fn migrate_legacy_xiaozhu_intro(prompt: &str) -> Option<String> {
    let identity_start = prompt.find("# 我是谁")?;
    let identity_heading_len = "# 我是谁".len();
    let identity_end = prompt[identity_start + identity_heading_len..]
        .find("\n# ")
        .map(|offset| identity_start + identity_heading_len + offset)
        .unwrap_or(prompt.len());
    let identity_section = &prompt[identity_start..identity_end];
    let updated_section = LEGACY_XIAOZHU_INTROS
        .iter()
        .fold(identity_section.to_owned(), |current, legacy| {
            current.replace(legacy, CURRENT_XIAOZHU_INTRO)
        });
    if updated_section == identity_section {
        return None;
    }
    let mut updated = String::with_capacity(prompt.len() + CURRENT_XIAOZHU_INTRO.len());
    updated.push_str(&prompt[..identity_start]);
    updated.push_str(&updated_section);
    updated.push_str(&prompt[identity_end..]);
    Some(updated)
}

/// Copy ship resources (personas) into the app data dir on first run,
/// so users can edit them without touching the install dir.
/// Returns a human-readable reason for the first failure, if any.
fn sync_ship_resources(app: &tauri::AppHandle, data_dir: &Path) -> Result<(), String> {
    let res_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位安装资源目录: {e}"))?;
    let mut shipped_personas_dir = None;
    for name in ["personas", "skills"] {
        let candidates = [res_dir.join("resources").join(name), res_dir.join(name)];
        let dst = data_dir.join(name);
        for src in candidates {
            if src.exists() {
                copy_missing_dir_recursive(&src, &dst)
                    .map_err(|e| format!("无法复制 {name} 资源到 {}: {e}", dst.display()))?;
                if name == "personas" {
                    shipped_personas_dir = Some(src);
                }
                break;
            }
        }
    }

    if let Some(shipped_personas_dir) = shipped_personas_dir {
        overwrite_builtin_xiaozhu_persona(&shipped_personas_dir, data_dir)
            .map_err(|error| format!("无法覆盖小著内置人设: {error}"))?;
    }

    let xiaozhu_persona = data_dir.join("personas").join("xiaozhu").join("persona.md");
    if let Ok(prompt) = std::fs::read_to_string(&xiaozhu_persona) {
        if let Some(updated) = migrate_legacy_xiaozhu_intro(&prompt) {
            std::fs::write(&xiaozhu_persona, updated).map_err(|error| {
                format!(
                    "无法更新小著默认人设 {}: {error}",
                    xiaozhu_persona.display()
                )
            })?;
        }
    }

    Ok(())
}

fn overwrite_builtin_xiaozhu_persona(
    shipped_personas_dir: &Path,
    data_dir: &Path,
) -> std::io::Result<()> {
    let source = shipped_personas_dir.join("xiaozhu").join("persona.md");
    let target_dir = data_dir.join("personas").join("xiaozhu");
    std::fs::create_dir_all(&target_dir)?;
    std::fs::copy(source, target_dir.join("persona.md"))?;
    Ok(())
}

fn copy_missing_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
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

/// Apply the non-user-specific OpenCode launch settings for YUME's sidecar.
///
/// `--pure` prevents globally installed OpenCode plugins from changing YUME's
/// behavior or producing system notifications for YUME chat replies. Provider
/// credentials and model definitions still arrive through YUME's own
/// environment variables below.
fn configure_sidecar_command(cmd: &mut Command, port: u16, workspace: &Path) {
    cmd.arg("--pure")
        .arg("serve")
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
        .current_dir(workspace);
}

fn spawn_sidecar(app: &tauri::AppHandle, port: u16) -> std::io::Result<Child> {
    let data_dir = app.path().app_data_dir().expect("app data dir unavailable");
    std::fs::create_dir_all(&data_dir)?;
    // A resource-copy failure means personas/skills will be missing, which
    // otherwise shows up as an unexplained empty persona list. Report it.
    if let Err(reason) = sync_ship_resources(app, &data_dir) {
        eprintln!("ship resource sync failed: {reason}");
        let _ = app.emit("deskmate://resource-error", &reason);
    }

    // Sessions live in a dedicated workspace dir under app data.
    let workspace = data_dir.join("workspace");
    std::fs::create_dir_all(&workspace)?;

    let bin = resolve_opencode(app);
    let mut cmd = Command::new(&bin);
    configure_sidecar_command(&mut cmd, port, &workspace);
    cmd.env_remove("OPENCODE_SERVER_PASSWORD")
        .env_remove("OPENCODE_SERVER_USERNAME");

    if let Some((config, auth)) = settings::sidecar_environment(app) {
        cmd.env("OPENCODE_CONFIG_CONTENT", config)
            .env("OPENCODE_AUTH_CONTENT", auth);
    }

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

pub(crate) fn restart_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let sidecar = app.state::<Sidecar>();
    let mut previous = sidecar
        .child
        .lock()
        .map_err(|_| "sidecar lock poisoned")?
        .take();
    if let Some(mut child) = previous.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let child = spawn_sidecar(app, sidecar.port).map_err(|error| error.to_string())?;
    *sidecar.child.lock().map_err(|_| "sidecar lock poisoned")? = Some(child);
    Ok(())
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
        .tooltip("YUME - 小著")
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
fn open_widget_settings(app: tauri::AppHandle) {
    show_settings_window(&app);
    let _ = app.emit("deskmate://settings-tab", "widget");
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

    let mut builder = tauri::Builder::default().manage(SettingsState::default());

    // Registered first, before any other plugin or window is created: a second
    // launch (double-clicking the icon again, autostart racing a manual start,
    // a stuck process from a crash) takes a named OS mutex here and exits
    // immediately if one is already held, forwarding its argv/cwd to the running
    // instance instead. This is what stops "several dozen processes" from a
    // single misbehaving launch path, and it also removes the two symptoms that
    // motivated it: two instances fighting over global shortcuts, and two
    // instances opening the same `deskmate-memory.db` file.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch is treated exactly like the tray "show" action:
            // bring the existing chat into view rather than doing nothing.
            let _ = show_chat(app);
        }));
    }

    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Native file picker: importing a pack needs a real filesystem path,
        // which a WebView `input[type=file]` never exposes.
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar {
            child: Mutex::new(None),
            port,
        })
        .manage(ccswitch::contract::CcSwitchSetupState::default())
        .manage(ChatShown(Mutex::new(false)))
        .manage(Arc::new(ChatMotion::default()))
        .invoke_handler(tauri::generate_handler![
            sidecar_base_url,
            load_persona,
            convert_ncm,
            toggle_chat,
            hide_chat,
            show_chat_window,
            preview_pet_scale,
            get_settings,
            set_settings,
            verify_api_key,
            fetch_ai_usage,
            open_settings,
            open_widget_settings,
            hide_settings,
            app_version,
            history::history_list,
            history::history_load,
            history::history_save,
            history::history_delete,
            packs::installed_packs,
            packs::import_pack,
            packs::uninstall_pack,
            memory::commands::memory_available,
            memory::commands::memory_create,
            memory::commands::memory_update,
            memory::commands::memory_list,
            memory::commands::memory_forget,
            memory::commands::memory_clear,
            memory::commands::memory_forget_conversation,
            memory::commands::memory_context,
            memory::commands::memory_export,
            memory::commands::memory_relationship,
            memory::commands::memory_set_relationship_summary,
            memory::commands::memory_link_task,
            memory::commands::memory_unlink_task,
            memory::commands::memory_unlink_deleted_task,
            updater::update_app
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Load persisted settings and apply startup side-effects.
            let loaded = settings::load(&handle);
            *app.state::<SettingsState>().0.lock().unwrap() = loaded.clone();
            settings::register_shortcuts(&handle, &loaded);
            if let Some(pet) = app.get_webview_window("pet") {
                let window_event_handle = handle.clone();
                pet.on_window_event(move |event| {
                    if should_follow_chat_on_window_event(event) {
                        reposition_visible_chat(&window_event_handle);
                    }
                    if let tauri::WindowEvent::Moved(position) = event {
                        settings::persist_pet_position(&window_event_handle, *position);
                    }
                });
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
                if let Some(position) = loaded.pet_position {
                    let _ = pet.set_position(tauri::PhysicalPosition::new(position.x, position.y));
                } else {
                    place_pet_bottom_right(&pet);
                }
            }
            app.manage(HistoryState(Mutex::new(history::load(&handle))));
            // Memory is optional infrastructure: if the database cannot open,
            // `MemoryState` records that and every memory command answers
            // MEMORY_DISABLED while chat and the pet keep working.
            app.manage(memory::MemoryState::initialize(&handle));
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
