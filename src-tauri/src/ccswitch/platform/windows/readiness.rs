use std::process::Child;
use std::thread;
use std::time::Duration;

use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

use super::CcSwitchPlatformError;

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const FRONTEND_MOUNT_GRACE: Duration = Duration::from_millis(750);
const EXISTING_INSTANCE_GRACE: Duration = Duration::from_millis(500);
const MAX_POLL_ATTEMPTS: usize = 300;
const CC_SWITCH_WINDOW_TITLE: &str = "CC Switch";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChildObservation {
    Running,
    ExitedSuccessfully,
    Failed,
}

pub(super) fn wait_for_cc_switch_frontend(child: &mut Child) -> Result<(), CcSwitchPlatformError> {
    let process_id = child.id();
    FrontendWaiter {
        observe_child: || match child.try_wait() {
            Ok(None) => ChildObservation::Running,
            Ok(Some(status)) if status.success() => ChildObservation::ExitedSuccessfully,
            Ok(Some(_)) | Err(_) => ChildObservation::Failed,
        },
        has_visible_window: || process_has_visible_window(process_id),
        sleep: thread::sleep,
        max_attempts: MAX_POLL_ATTEMPTS,
    }
    .wait()
}

struct FrontendWaiter<ObserveChild, HasVisibleWindow, Sleep> {
    observe_child: ObserveChild,
    has_visible_window: HasVisibleWindow,
    sleep: Sleep,
    max_attempts: usize,
}

impl<ObserveChild, HasVisibleWindow, Sleep> FrontendWaiter<ObserveChild, HasVisibleWindow, Sleep>
where
    ObserveChild: FnMut() -> ChildObservation,
    HasVisibleWindow: FnMut() -> bool,
    Sleep: FnMut(Duration),
{
    fn wait(&mut self) -> Result<(), CcSwitchPlatformError> {
        for _ in 0..self.max_attempts {
            match (self.observe_child)() {
                ChildObservation::ExitedSuccessfully => {
                    (self.sleep)(EXISTING_INSTANCE_GRACE);
                    return Ok(());
                }
                ChildObservation::Failed => return Err(CcSwitchPlatformError::OpenFailed),
                ChildObservation::Running => {}
            }
            if (self.has_visible_window)() {
                (self.sleep)(FRONTEND_MOUNT_GRACE);
                return Ok(());
            }
            (self.sleep)(POLL_INTERVAL);
        }
        Err(CcSwitchPlatformError::OpenFailed)
    }
}

fn process_has_visible_window(process_id: u32) -> bool {
    let mut search = WindowSearch {
        process_id,
        found: false,
    };
    let search_ptr = std::ptr::from_mut(&mut search);
    let context = isize::from_ne_bytes(search_ptr.expose_provenance().to_ne_bytes());
    // SAFETY: Category 8 (FFI boundary). Invariant: `context` is the exposed address of
    // `search`, whose exclusive borrow lasts through the synchronous enumeration.
    unsafe {
        EnumWindows(Some(find_visible_process_window), context);
    }
    search.found
}

struct WindowSearch {
    process_id: u32,
    found: bool,
}

unsafe extern "system" fn find_visible_process_window(window: HWND, context: LPARAM) -> BOOL {
    let address = usize::from_ne_bytes(context.to_ne_bytes());
    // SAFETY: Category 8 (FFI boundary). Invariant: `context` retains the exposed address
    // of the live, aligned `WindowSearch` exclusively borrowed by the synchronous caller.
    let search = unsafe { &mut *std::ptr::with_exposed_provenance_mut::<WindowSearch>(address) };
    // SAFETY: Category 8 (FFI boundary). Invariant: `window` is the HWND being enumerated
    // by Windows for the duration of this callback.
    if unsafe { IsWindowVisible(window) } == 0 {
        return 1;
    }
    let mut owner_process_id = 0;
    // SAFETY: Category 8 (FFI boundary). Invariant: `window` is the current enumerated HWND,
    // and the output pointer targets initialized stack storage live through this call.
    unsafe {
        GetWindowThreadProcessId(window, &mut owner_process_id);
    }
    if owner_process_id == search.process_id && window_has_cc_switch_title(window) {
        search.found = true;
        return 0;
    }
    1
}

fn window_has_cc_switch_title(window: HWND) -> bool {
    // SAFETY: Category 8 (FFI boundary). Invariant: `window` is the current enumerated HWND
    // and remains valid for this synchronous query.
    let title_length = unsafe { GetWindowTextLengthW(window) };
    if title_length <= 0 {
        return false;
    }
    let Ok(title_length) = usize::try_from(title_length) else {
        return false;
    };
    let Some(buffer_length) = title_length.checked_add(1) else {
        return false;
    };
    let Ok(buffer_length_i32) = i32::try_from(buffer_length) else {
        return false;
    };
    let mut title = vec![0_u16; buffer_length];
    // SAFETY: Category 8 (FFI boundary). Invariant: `title` is writable for
    // `buffer_length_i32` UTF-16 units and `window` remains valid during this call.
    let copied = unsafe { GetWindowTextW(window, title.as_mut_ptr(), buffer_length_i32) };
    if copied <= 0 {
        return false;
    }
    let Ok(copied) = usize::try_from(copied) else {
        return false;
    };
    if copied > title.len() {
        return false;
    }
    String::from_utf16_lossy(&title[..copied]).eq_ignore_ascii_case(CC_SWITCH_WINDOW_TITLE)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    #[test]
    fn waits_for_a_visible_window_then_allows_frontend_mounting() {
        let mut windows = VecDeque::from([false, false, true]);
        let mut sleeps = Vec::new();

        FrontendWaiter {
            observe_child: || ChildObservation::Running,
            has_visible_window: || windows.pop_front().unwrap_or(true),
            sleep: |duration| sleeps.push(duration),
            max_attempts: 4,
        }
        .wait()
        .expect("visible frontend becomes ready");

        assert_eq!(
            sleeps,
            vec![POLL_INTERVAL, POLL_INTERVAL, FRONTEND_MOUNT_GRACE]
        );
    }

    #[test]
    fn accepts_a_clean_secondary_instance_exit_after_a_short_grace() {
        let mut sleeps = Vec::new();

        FrontendWaiter {
            observe_child: || ChildObservation::ExitedSuccessfully,
            has_visible_window: || false,
            sleep: |duration| sleeps.push(duration),
            max_attempts: 1,
        }
        .wait()
        .expect("existing instance is already initialized");

        assert_eq!(sleeps, vec![EXISTING_INSTANCE_GRACE]);
    }

    #[test]
    fn fails_closed_for_a_crash_or_a_window_timeout() {
        let crash = FrontendWaiter {
            observe_child: || ChildObservation::Failed,
            has_visible_window: || false,
            sleep: |_| {},
            max_attempts: 1,
        }
        .wait();
        let timeout = FrontendWaiter {
            observe_child: || ChildObservation::Running,
            has_visible_window: || false,
            sleep: |_| {},
            max_attempts: 2,
        }
        .wait();

        assert_eq!(crash, Err(CcSwitchPlatformError::OpenFailed));
        assert_eq!(timeout, Err(CcSwitchPlatformError::OpenFailed));
    }
}
