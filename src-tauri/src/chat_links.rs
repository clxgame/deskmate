const CREATOR_CONTACT_URL: &str =
    "https://applink.feishu.cn/client/chat/open?openId=ou_a210f858d830187b119d691364a3d628";

fn external_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid link".to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        return Err("Unsupported link protocol".to_string());
    }
    Ok(url)
}

fn window_link(label: &str, raw: &str) -> Result<url::Url, String> {
    if label != "chat" && !(label == "settings" && raw == CREATOR_CONTACT_URL) {
        return Err("This window cannot open this link".to_string());
    }
    external_url(raw)
}

#[tauri::command]
pub async fn open_chat_link(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    let url = window_link(window.label(), &url)?;
    tauri::async_runtime::spawn_blocking(move || open_system_link(url.as_str()))
        .await
        .map_err(|_| "Could not open link".to_string())?
}

pub(crate) fn open_system_link(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new(r"C:\Windows\System32\rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", url]);
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("/usr/bin/open");
        command.arg(url);
        command
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    let status = command
        .status()
        .map_err(|_| "Could not open link".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open link".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{external_url, window_link, CREATOR_CONTACT_URL};

    #[test]
    fn settings_can_only_open_the_creator_contact() {
        assert!(window_link("settings", CREATOR_CONTACT_URL).is_ok());
        assert!(window_link("settings", "https://example.com").is_err());
        assert!(window_link("pet", CREATOR_CONTACT_URL).is_err());
        assert!(window_link("chat", "https://example.com").is_ok());
        assert!(window_link("chat", "javascript:alert(1)").is_err());
    }

    #[test]
    fn accepts_only_external_web_and_email_links() {
        for url in [
            "https://example.com/path?q=hello",
            "http://example.com",
            "mailto:hi@example.com",
        ] {
            assert!(external_url(url).is_ok(), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///C:/secret",
            "ccswitch://import",
            "data:text/html,hi",
            "/settings",
            "#section",
        ] {
            assert!(external_url(url).is_err(), "{url}");
        }
    }
}
