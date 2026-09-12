fn external_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid link".to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        return Err("Unsupported link protocol".to_string());
    }
    Ok(url)
}

#[tauri::command]
pub async fn open_chat_link(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the chat window can open chat links".to_string());
    }
    let url = external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || open_system_link(url.as_str()))
        .await
        .map_err(|_| "Could not open link".to_string())?
}

fn open_system_link(url: &str) -> Result<(), String> {
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
    use super::external_url;

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
