use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct HistoryOrganizerRequest(AtomicBool);

impl HistoryOrganizerRequest {
    fn request(&self) {
        self.0.store(true, Ordering::Release);
    }

    fn consume(&self, label: &str) -> Result<bool, String> {
        if label != "chat" {
            return Err("only the chat window can consume history organizer requests".to_owned());
        }
        Ok(self.0.swap(false, Ordering::AcqRel))
    }
}

fn require_history_window(label: &str) -> Result<(), String> {
    if label != "chat" && label != "workbench" {
        return Err("only chat or workbench windows can open the history organizer".to_owned());
    }
    Ok(())
}

pub(crate) fn open(app: &tauri::AppHandle) -> Result<(), String> {
    app.state::<HistoryOrganizerRequest>().request();
    crate::show_chat(app)?;
    let chat = app
        .get_webview_window("chat")
        .ok_or("chat window missing")?;
    chat.set_focus().map_err(|error| error.to_string())?;
    app.emit_to("chat", "history://open", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn show_history_organizer(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    require_history_window(window.label())?;
    open(&app)
}

#[tauri::command]
pub(crate) fn consume_history_organizer_request(
    window: tauri::WebviewWindow,
    state: tauri::State<HistoryOrganizerRequest>,
) -> Result<bool, String> {
    state.consume(window.label())
}

#[cfg(test)]
mod tests {
    use super::{require_history_window, HistoryOrganizerRequest};

    #[test]
    fn request_survives_until_chat_mounts_and_consumes_once() {
        let state = HistoryOrganizerRequest::default();
        state.request();
        assert_eq!(state.consume("chat"), Ok(true));
        assert_eq!(state.consume("chat"), Ok(false));
    }

    #[test]
    fn rejected_window_cannot_consume_the_chat_request() {
        let state = HistoryOrganizerRequest::default();
        state.request();
        assert!(state.consume("workbench").is_err());
        assert_eq!(state.consume("chat"), Ok(true));
    }

    #[test]
    fn duplicate_requests_coalesce_until_chat_consumes() {
        let state = HistoryOrganizerRequest::default();
        state.request();
        state.request();
        assert_eq!(state.consume("chat"), Ok(true));
        assert_eq!(state.consume("chat"), Ok(false));
    }

    #[test]
    fn only_chat_and_workbench_can_open_history() {
        assert!(require_history_window("chat").is_ok());
        assert!(require_history_window("workbench").is_ok());
        for label in ["pet", "settings", "", "external", "workbench-other"] {
            assert!(require_history_window(label).is_err());
        }
    }
}
