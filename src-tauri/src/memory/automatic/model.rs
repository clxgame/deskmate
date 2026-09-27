use super::*;
use serde_json::{json, Value};
use std::{
    io::Read,
    time::{Duration, Instant},
};

pub(super) struct Client {
    base: String,
    auth: String,
    directory: String,
    http: ureq::Agent,
}
impl Client {
    pub fn new(app: &tauri::AppHandle, directory: &str) -> Self {
        Self {
            base: crate::sidecar_url(app),
            auth: crate::sidecar_auth_header(app),
            directory: directory.into(),
            http: ureq::AgentBuilder::new()
                .redirects(0)
                .timeout(Duration::from_secs(3))
                .build(),
        }
    }
    pub fn fast(mut self) -> Self {
        self.http = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(Duration::from_millis(600))
            .build();
        self
    }
    pub fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        self.page(method, path, body).map(|(value, _)| value)
    }
    fn page(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<(Value, Option<String>), String> {
        let mut url =
            url::Url::parse(&format!("{}{}", self.base, path)).map_err(|_| "INVALID_ENDPOINT")?;
        url.query_pairs_mut()
            .append_pair("directory", &self.directory);
        let req = self
            .http
            .request(method, url.as_str())
            .set("Authorization", &self.auth);
        let response = if let Some(body) = body {
            req.send_json(body)
        } else {
            req.call()
        }
        .map_err(|error| {
            if matches!(error, ureq::Error::Status(404, _)) {
                "SOURCE_GONE"
            } else {
                "NATIVE_UNAVAILABLE"
            }
        })?;
        let cursor = response.header("x-next-cursor").map(str::to_owned);
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "NATIVE_UNAVAILABLE")?;
        if bytes.len() > 1024 * 1024 {
            return Err("NATIVE_TOO_LARGE".into());
        }
        if bytes.is_empty() {
            return Ok((Value::Null, cursor));
        }
        serde_json::from_slice(&bytes)
            .map(|value| (value, cursor))
            .map_err(|_| "NATIVE_INVALID_RESPONSE".into())
    }
    pub fn session(&self, id: &str) -> Result<Value, String> {
        self.request("GET", &format!("/session/{id}"), None)
    }
    pub fn messages(&self, id: &str) -> Result<Vec<Value>, String> {
        let result = self.request("GET", &format!("/session/{id}/message?limit=32"), None)?;
        result
            .as_array()
            .cloned()
            .ok_or_else(|| "NATIVE_INVALID_RESPONSE".into())
    }
    /// Bounded source lookup survives a busy conversation advancing past its newest page.
    pub fn source_messages(&self, id: &str, source: &str) -> Result<Vec<Value>, String> {
        let mut cursor = None;
        let mut found = Vec::new();
        for _ in 0..8 {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query.append_pair("limit", "32");
            if let Some(before) = cursor.as_deref() {
                query.append_pair("before", before);
            }
            let (page, next) = self.page(
                "GET",
                &format!("/session/{id}/message?{}", query.finish()),
                None,
            )?;
            let page = page.as_array().ok_or("NATIVE_INVALID_RESPONSE")?;
            // Retain only the source turn, not other conversation bodies.
            found.extend(
                page.iter()
                    .filter(|m| m["info"]["id"] == source || m["info"]["parentID"] == source)
                    .cloned(),
            );
            if found.iter().any(|m| m["info"]["id"] == source) || next.is_none() {
                break;
            }
            cursor = next;
        }
        Ok(found)
    }
    pub fn remove(&self, id: &str) -> bool {
        let mut url = match url::Url::parse(&format!("{}/session/{id}", self.base)) {
            Ok(u) => u,
            Err(_) => return false,
        };
        url.query_pairs_mut()
            .append_pair("directory", &self.directory);
        matches!(
            self.http
                .delete(url.as_str())
                .set("Authorization", &self.auth)
                .call(),
            Ok(_) | Err(ureq::Error::Status(404, _))
        )
    }
    pub fn generate(
        &self,
        job: &Job,
        text: &str,
        verified_results: &str,
        candidates: Value,
        mut child: impl FnMut(Option<&str>) -> Result<(), String>,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<Extraction, String> {
        let r = &job.registration;
        let session=self.request("POST","/session",Some(json!({"parentID":r.session_id,"title":"YUME internal extraction","permission":[{"permission":"*","pattern":"*","action":"deny"}]})))?;
        let id = session["id"]
            .as_str()
            .filter(|s| safe_id(s))
            .ok_or("INVALID_INTERNAL_SESSION")?;
        if let Err(error) = child(Some(id)) {
            self.remove(id);
            return Err(error);
        }
        let result = (|| {
            let ids = self.request("GET", "/experimental/tool/ids", None)?;
            let mut tools = serde_json::Map::new();
            for tool in ids.as_array().ok_or("INVALID_TOOL_LIST")? {
                if let Some(id) = tool.as_str() {
                    tools.insert(id.into(), json!(false));
                }
            }
            for id in crate::settings::desktop_mcp_permission_ids() {
                tools.insert(id, json!(false));
            }
            let offset = chrono::FixedOffset::east_opt(r.utc_offset).ok_or("INVALID_TIMEZONE")?;
            let at = chrono::DateTime::from_timestamp_millis(r.received_at)
                .ok_or("INVALID_SOURCE_TIME")?
                .with_timezone(&offset);
            let workday = crate::worklog::calendar::business_date(at.naive_local());
            let input = json!({"newUserText":text,"verifiedResults":verified_results,"workday":workday.to_string(),"workspace":r.workspace,"memoryEnabled":r.memory,"worklogEnabled":r.worklog,"existing":candidates});
            let message = format!("msg_{}", uuid::Uuid::new_v4().simple());
            self.request("POST",&format!("/session/{id}/prompt_async"),Some(json!({"messageID":message,"model":{"providerID":r.provider_id,"modelID":r.model_id},"tools":tools,"system":SYSTEM,"parts":[{"type":"text","text":input.to_string()}]}))).or_else(|e| if e=="NATIVE_INVALID_RESPONSE" {Ok(Value::Null)}else{Err(e)})?;
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline && !cancelled() {
                let messages = self.messages(id)?;
                for m in &messages {
                    if m["info"]["role"] != "assistant" || m["info"]["parentID"] != message {
                        continue;
                    }
                    if !m["info"]["error"].is_null() {
                        return Err("EXTRACTION_MODEL_ERROR".into());
                    }
                    if m["info"]["finish"] == "stop" && m["info"]["time"]["completed"].is_number() {
                        let output = message_text(m);
                        if output.len() > 24_000 {
                            return Err("EXTRACTION_TOO_LARGE".into());
                        }
                        let output = output
                            .trim()
                            .trim_start_matches("```json")
                            .trim_start_matches("```")
                            .trim_end_matches("```")
                            .trim();
                        return serde_json::from_str(output)
                            .map_err(|_| "EXTRACTION_INVALID_JSON".into());
                    }
                }
                std::thread::sleep(Duration::from_millis(350));
            }
            Err(if cancelled() {
                "EXTRACTION_INVALIDATED"
            } else {
                "EXTRACTION_TIMEOUT"
            }
            .into())
        })();
        let _ = self.request("POST", &format!("/session/{id}/abort"), None);
        if self.remove(id) {
            child(None)?;
        } else {
            return Err("INTERNAL_CLEANUP_PENDING".into());
        }
        result
    }
}
pub(super) fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub(super) fn message_text(message: &Value) -> String {
    message["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["type"] == "text" && p["synthetic"] != true && p["ignored"] != true)
        .filter_map(|p| p["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
pub(super) fn internal_source(message: &Value) -> bool {
    let system = message["info"]["system"].as_str().unwrap_or("");
    system.contains("YUME_INTERNAL_MEMORY_V1") || system.contains(crate::worklog::reports::SYSTEM)
}
pub(super) fn settled(messages: &[Value], user: &str) -> bool {
    let replies: Vec<_> = messages
        .iter()
        .filter(|m| m["info"]["role"] == "assistant" && m["info"]["parentID"] == user)
        .collect();
    !replies.is_empty()
        && replies
            .iter()
            .all(|m| m["info"]["time"]["completed"].is_number())
        && replies.iter().any(|m| {
            m["info"]["time"]["completed"].is_number()
                && (matches!(m["info"]["finish"].as_str(), Some("stop" | "length"))
                    || !m["info"]["error"].is_null())
        })
        && !replies.iter().any(|m| {
            m["parts"].as_array().into_iter().flatten().any(|p| {
                p["type"] == "tool"
                    && matches!(p["state"]["status"].as_str(), Some("pending" | "running"))
            })
        })
}

pub(super) fn owns_session(session: &Value, directory: &str) -> bool {
    session["directory"]
        .as_str()
        .and_then(|d| crate::history::catalog_model::canonical_directory(d).ok())
        .as_deref()
        == Some(directory)
}
