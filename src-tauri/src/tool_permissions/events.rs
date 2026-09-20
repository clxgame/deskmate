use super::runtime::PermissionRequest;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

#[derive(Default)]
struct StreamState {
    connected: bool,
    requests: BTreeMap<String, PermissionRequest>,
}
#[derive(Clone, Default)]
pub struct PermissionEvents {
    state: Arc<Mutex<StreamState>>,
    stopped: Arc<AtomicBool>,
}
impl PermissionEvents {
    pub fn start(base: String) -> Self {
        let events = Self::default();
        let worker = events.clone();
        std::thread::spawn(move || {
            while !worker.stopped.load(Ordering::Relaxed) {
                if let Err(error) = worker.read(&base) {
                    eprintln!("permission stream: {error}");
                }
                if let Ok(mut state) = worker.state.lock() {
                    *state = StreamState::default();
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        });
        events
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
    fn read(&self, base: &str) -> Result<(), String> {
        let response = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(3))
            .timeout_read(Duration::from_secs(45))
            .build()
            .get(&format!("{base}/event"))
            .call()
            .map_err(|error| error.to_string())?;
        self.state
            .lock()
            .map_err(|_| "permission_stream_lock")?
            .connected = true;
        for line in BufReader::new(response.into_reader()).lines() {
            if self.stopped.load(Ordering::Relaxed) {
                break;
            }
            let line = line.map_err(|error| error.to_string())?;
            if let Some(data) = line.strip_prefix("data:") {
                if let Ok(event) = serde_json::from_str::<Value>(data.trim()) {
                    self.accept(event);
                }
            }
        }
        Ok(())
    }
    pub(super) fn accept(&self, event: Value) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let properties = &event["properties"];
        match event["type"].as_str() {
            Some("permission.asked") => {
                if let Ok(request) = serde_json::from_value::<PermissionRequest>(properties.clone())
                {
                    state.requests.insert(request.id.clone(), request);
                }
            }
            Some("permission.replied") => {
                if let Some(id) = properties["requestID"].as_str() {
                    state.requests.remove(id);
                }
            }
            _ => {}
        }
    }
    // OpenCode 1.18.21's list encoder rejects webfetch's omitted timeout.
    // Its SSE encoder carries the same request correctly. Only use requests
    // observed directly from the live, host-owned stream; never renderer input.
    pub(super) fn snapshot(&self) -> Result<Vec<PermissionRequest>, String> {
        let state = self.state.lock().map_err(|_| "permission_unavailable")?;
        if !state.connected || state.requests.is_empty() {
            return Err("permission_unavailable".into());
        }
        Ok(state.requests.values().cloned().collect())
    }

    pub(super) fn pending_scoped(
        &self,
        base: &str,
        directory: &Path,
        session: &str,
    ) -> Result<Vec<PermissionRequest>, String> {
        let requests = super::scoped::pending_scoped(base, directory).or_else(|error| {
            if error == "permission_invalid_metadata" {
                self.snapshot().map_err(|_| error)
            } else {
                Err(error)
            }
        })?;
        requests
            .into_iter()
            .filter(|request| request.session_id == session)
            .map(|mut request| {
                if matches!(
                    request.permission.as_str(),
                    "read" | "glob" | "grep" | "list"
                ) {
                    let metadata = request
                        .metadata
                        .as_object_mut()
                        .ok_or_else(|| "permission_invalid_metadata".to_owned())?;
                    match metadata.get("path") {
                        None => {
                            metadata.insert(
                                "path".into(),
                                Value::String(crate::agent::opencode_wire_directory(directory)),
                            );
                        }
                        Some(Value::String(path)) if !path.is_empty() => {}
                        Some(_) => return Err("permission_invalid_metadata".to_owned()),
                    }
                }
                Ok(request)
            })
            .collect()
    }
}

#[cfg(test)]
#[path = "events_scoped_tests.rs"]
mod scoped_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn stream_fallback_tracks_replies_and_fails_closed_when_disconnected() {
        let events = PermissionEvents::default();
        events.accept(json!({"type":"permission.asked","properties":{"id":"p1","sessionID":"s1","permission":"webfetch","patterns":["https://example.test"],"metadata":{"url":"https://example.test"}}}));
        assert!(events.snapshot().is_err());
        events.state.lock().expect("lock").connected = true;
        assert_eq!(events.snapshot().expect("live request")[0].id, "p1");
        events.accept(json!({"type":"permission.replied","properties":{"requestID":"p1"}}));
        assert!(events.snapshot().is_err());
    }

    #[test]
    #[ignore = "requires an isolated live OpenCode instance"]
    fn live_web_permission_without_timeout() {
        let base = std::env::var("YUME_PERMISSION_TEST_BASE").expect("isolated engine URL");
        assert!(base.starts_with("http://127.0.0.1:"));
        let ready = std::env::var("YUME_PERMISSION_TEST_READY").expect("ready file");
        let events = PermissionEvents::start(base.clone());
        let deadline = std::time::Instant::now() + Duration::from_secs(40);
        while !events.state.lock().expect("lock").connected {
            assert!(
                std::time::Instant::now() < deadline,
                "stream did not connect"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        std::fs::write(ready, "ready").expect("write readiness");
        let requests = loop {
            if let Ok(requests) = super::super::runtime::pending_with_events(&base, &events) {
                if !requests.is_empty() {
                    break requests;
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "web permission did not arrive"
            );
            std::thread::sleep(Duration::from_millis(50));
        };
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].permission, "webfetch");
        assert!(requests[0].metadata.get("timeout").is_none());
        let session = requests[0].session_id.clone();
        let waiting = super::super::runtime::resolve_requests(
            &base,
            &session,
            &super::super::ToolPermissions {
                web: super::super::Mode::Deny,
                ..Default::default()
            },
            requests,
        )
        .expect("host rejects web request");
        assert!(waiting.is_empty());
        events.stop();
    }
}
