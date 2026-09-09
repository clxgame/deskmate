/// Reads physical primary-button state independently of webview pointer delivery.
#[tauri::command]
pub async fn pet_primary_button_down() -> bool {
    platform_primary_button_down()
}

#[cfg(windows)]
fn platform_primary_button_down() -> bool {
    use windows_sys::Win32::UI::{
        Input::KeyboardAndMouse::GetAsyncKeyState,
        WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON},
    };
    // SAFETY: FFI boundary uses the windows-sys system ABI and scalar parameters
    // only. SM_SWAPBUTTON is a valid metric; neither call receives Rust memory.
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    // SAFETY: primary_button returns only the documented VK_LBUTTON/VK_RBUTTON
    // values. GetAsyncKeyState takes no pointers and returns an initialized SHORT.
    button_is_down(unsafe { GetAsyncKeyState(primary_button(swapped)) })
}

// Unsupported platforms release the lock; this desktop pet targets Windows.
#[cfg(not(windows))]
const fn platform_primary_button_down() -> bool {
    false
}

#[cfg(any(windows, test))]
const fn primary_button(swapped: bool) -> i32 {
    if swapped {
        2
    } else {
        1
    }
}

#[cfg(any(windows, test))]
const fn button_is_down(state: i16) -> bool {
    state & i16::MIN != 0
}
#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    #[test]
    fn released_when_platform_is_unsupported() {
        assert!(!super::platform_primary_button_down());
    }

    #[test]
    fn left_is_primary_when_buttons_are_standard() {
        assert_eq!(super::primary_button(false), 1);
    }

    #[test]
    fn right_is_primary_when_buttons_are_swapped() {
        assert_eq!(super::primary_button(true), 2);
    }

    #[test]
    fn down_when_high_bit_is_set() {
        assert!(super::button_is_down(i16::MIN));
    }

    #[test]
    fn released_when_only_prior_press_bit_is_set() {
        assert!(!super::button_is_down(1));
    }

    #[test]
    fn released_when_state_is_zero() {
        assert!(!super::button_is_down(0));
    }
}
