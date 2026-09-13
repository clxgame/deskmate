use tauri::{LogicalPosition, LogicalSize, Manager};

fn dimensions(large: bool, available: Option<LogicalSize<f64>>) -> LogicalSize<f64> {
    let preferred = if large {
        LogicalSize::new(1040.0, 760.0)
    } else {
        LogicalSize::new(720.0, 520.0)
    };
    fit_size(preferred, available)
}

fn fit_size(preferred: LogicalSize<f64>, available: Option<LogicalSize<f64>>) -> LogicalSize<f64> {
    available.map_or(preferred, |area| {
        LogicalSize::new(
            preferred.width.min((area.width - 32.0).max(1.0)),
            preferred.height.min((area.height - 32.0).max(1.0)),
        )
    })
}

pub(crate) fn apply_chat(app: &tauri::AppHandle, large: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("chat") else {
        return Ok(());
    };
    let monitor = match app.get_webview_window("pet") {
        Some(pet) => pet.current_monitor()?,
        None => window.current_monitor()?,
    };
    let monitor = match monitor {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };
    let available = monitor.map(|monitor| {
        monitor
            .work_area()
            .size
            .to_logical::<f64>(monitor.scale_factor())
    });
    window.set_size(fit_size(chat_dimensions(large), available))?;
    #[cfg(feature = "worklog-qa")]
    eprintln!(
        "chat window QA: large={large}, physical_size={:?}, scale_factor={:?}",
        window.inner_size(),
        window.scale_factor()
    );
    Ok(())
}

fn chat_dimensions(large: bool) -> LogicalSize<f64> {
    if large {
        LogicalSize::new(720.0, 760.0)
    } else {
        LogicalSize::new(420.0, 560.0)
    }
}

pub(crate) fn apply(app: &tauri::AppHandle, large: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("settings") else {
        return Ok(());
    };
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };
    if let Some(monitor) = monitor {
        let factor = monitor.scale_factor();
        let area = monitor.work_area();
        let available = area.size.to_logical::<f64>(factor);
        let size = dimensions(large, Some(available));
        let origin = area.position.to_logical::<f64>(factor);
        window.set_size(size)?;
        window.set_position(LogicalPosition::new(
            origin.x + (available.width - size.width) / 2.0,
            origin.y + (available.height - size.height) / 2.0,
        ))?;
    } else {
        window.set_size(dimensions(large, None))?;
        window.center()?;
    }
    #[cfg(feature = "worklog-qa")]
    eprintln!(
        "settings window QA: large={large}, physical_size={:?}, scale_factor={:?}",
        window.inner_size(),
        window.scale_factor()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_settings_default_to_compact_and_large_choice_round_trips() {
        let mut settings: crate::settings::Settings = serde_json::from_str("{}").unwrap();
        assert!(!settings.settings_large);
        assert!(!settings.chat_large);
        settings.settings_large = true;
        settings.chat_large = true;
        let json = serde_json::to_string(&settings).unwrap();
        let restored: crate::settings::Settings = serde_json::from_str(&json).unwrap();
        assert!(restored.settings_large);
        assert!(restored.chat_large);
    }

    #[test]
    fn sizes_fit_the_work_area_in_logical_pixels() {
        assert_eq!(dimensions(false, None), LogicalSize::new(720.0, 520.0));
        assert_eq!(dimensions(true, None), LogicalSize::new(1040.0, 760.0));
        let available = Some(LogicalSize::new(900.0, 600.0));
        assert_eq!(dimensions(true, available), LogicalSize::new(868.0, 568.0));
        assert_eq!(dimensions(false, available), LogicalSize::new(720.0, 520.0));
    }

    #[test]
    fn chat_sizes_fit_small_screens_and_keep_compact_defaults() {
        assert_eq!(chat_dimensions(false), LogicalSize::new(420.0, 560.0));
        assert_eq!(chat_dimensions(true), LogicalSize::new(720.0, 760.0));
        let available = Some(LogicalSize::new(640.0, 600.0));
        assert_eq!(
            fit_size(chat_dimensions(true), available),
            LogicalSize::new(608.0, 568.0)
        );
    }
}
