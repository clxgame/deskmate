use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt as _;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use uiautomation::patterns::UIInvokePattern;
use uiautomation::types::ControlType;
use uiautomation::{UIAutomation, UIElement};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::LocalAiDeploymentError;
use crate::ccswitch::platform::CcSwitchInstallation;

const IMPORT_BUTTON_NAMES: &[&str] =
    &["导入", "Import", "インポート", "가져오기", "匯入", "Импорт"];

pub(super) fn confirm_cc_switch_import(
    installation: &CcSwitchInstallation,
    provider_name: &str,
    endpoint: &str,
    model: &str,
) -> Result<(), LocalAiDeploymentError> {
    let trusted_executable = installation
        .executable
        .canonicalize()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_window_untrusted"))?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(25) {
        if try_confirm(&trusted_executable, provider_name, endpoint, model)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(LocalAiDeploymentError::new(
        "local_ai_ccswitch_import_ui_unavailable",
    ))
}

fn try_confirm(
    trusted_executable: &Path,
    provider_name: &str,
    endpoint: &str,
    model: &str,
) -> Result<bool, LocalAiDeploymentError> {
    let automation = UIAutomation::new()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_automation_failed"))?;
    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .contains_name("CC Switch")
        .timeout(0)
        .find_all()
        .unwrap_or_default();
    for window in windows {
        if !window_is_trusted(&window, trusted_executable) {
            continue;
        }
        if !contains_expected(&automation, &window, provider_name)
            || !contains_expected(&automation, &window, endpoint)
            || !contains_expected(&automation, &window, model)
        {
            continue;
        }
        for label in IMPORT_BUTTON_NAMES {
            let button = automation
                .create_matcher()
                .from_ref(&window)
                .control_type(ControlType::Button)
                .name(*label)
                .depth(40)
                .timeout(0)
                .find_first();
            let Ok(button) = button else {
                continue;
            };
            if !button.is_enabled().unwrap_or(false) {
                continue;
            }
            let pattern = button
                .get_pattern::<UIInvokePattern>()
                .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_automation_failed"))?;
            pattern
                .invoke()
                .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_automation_failed"))?;
            return Ok(true);
        }
    }
    Ok(false)
}

fn contains_expected(automation: &UIAutomation, window: &UIElement, value: &str) -> bool {
    automation
        .create_matcher()
        .from_ref(window)
        .contains_name(value)
        .depth(40)
        .timeout(0)
        .find_first()
        .is_ok()
}

fn window_is_trusted(window: &UIElement, trusted_executable: &Path) -> bool {
    let Ok(process_id) = window.get_process_id() else {
        return false;
    };
    process_image_path(process_id)
        .and_then(|path| path.canonicalize().ok())
        .is_some_and(|path| path == trusted_executable)
}

fn process_image_path(process_id: u32) -> Option<PathBuf> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return None;
    }
    let result = query_process_image(handle);
    unsafe {
        CloseHandle(handle);
    }
    result
}

fn query_process_image(handle: HANDLE) -> Option<PathBuf> {
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let succeeded = unsafe {
        QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length)
    };
    if succeeded == 0 || length == 0 {
        return None;
    }
    buffer.truncate(length as usize);
    Some(PathBuf::from(OsString::from_wide(&buffer)))
}
