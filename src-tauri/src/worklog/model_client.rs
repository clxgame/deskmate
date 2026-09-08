use super::error::{WorklogError, WorklogResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelEndpoint {
    pub base_url: String,
    pub provider_id: String,
    pub model_id: String,
    pub epoch: String,
}
#[derive(Deserialize)]
struct Health {
    healthy: bool,
}
#[derive(Deserialize)]
struct Session {
    id: String,
}
#[derive(Deserialize)]
struct Message {
    info: MessageInfo,
    parts: Vec<Part>,
}
#[derive(Deserialize)]
struct MessageInfo {
    role: String,
    #[serde(rename = "parentID")]
    parent_id: Option<String>,
    finish: Option<String>,
    time: MessageTime,
    error: Option<ModelError>,
}
#[derive(Deserialize)]
struct MessageTime {
    completed: Option<u64>,
}
#[derive(Deserialize)]
struct ModelError {
    name: String,
}
#[derive(Deserialize)]
#[serde(tag = "type")]
enum Part {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(other)]
    Other,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Model<'a> {
    #[serde(rename = "providerID")]
    provider_id: &'a str,
    #[serde(rename = "modelID")]
    model_id: &'a str,
}

pub struct ModelClient {
    endpoint: ModelEndpoint,
    agent: ureq::Agent,
}
impl ModelClient {
    pub fn new(endpoint: ModelEndpoint) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(10))
            .build();
        Self { endpoint, agent }
    }
    pub fn ready(&self, timeout: Duration) -> bool {
        self.agent
            .get(&format!("{}/global/health", self.endpoint.base_url))
            .timeout(timeout)
            .call()
            .ok()
            .and_then(|response| response.into_json::<Health>().ok())
            .is_some_and(|health| health.healthy)
    }
    pub fn create_session(&self) -> WorklogResult<String> {
        let result: Session = self.agent.post(&format!("{}/session",self.endpoint.base_url))
            .send_json(serde_json::json!({"title":"Work journal report","permission":[{"permission":"*","pattern":"*","action":"deny"}]}))
            .map_err(http_error)?.into_json().map_err(|_| wire_error())?;
        if result.id.is_empty()
            || !result
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(wire_error());
        }
        Ok(result.id)
    }
    pub fn generate(
        &self,
        request: (&str, &str),
        mut heartbeat: impl FnMut() -> WorklogResult<()>,
    ) -> WorklogResult<String> {
        let (session, text) = request;
        let deadline = Instant::now() + Duration::from_secs(300);
        let tool_ids: Vec<String> = self
            .agent
            .get(&format!("{}/experimental/tool/ids", self.endpoint.base_url))
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|_| wire_error())?;
        let tools: BTreeMap<String, bool> = tool_ids.into_iter().map(|id| (id, false)).collect();
        let message_id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        heartbeat()?;
        self.agent.post(&format!("{}/session/{session}/prompt_async",self.endpoint.base_url))
            .send_json(serde_json::json!({"messageID":message_id,"model":Model{provider_id:&self.endpoint.provider_id,model_id:&self.endpoint.model_id},"tools":tools,"system":super::reports::SYSTEM,"parts":[{"type":"text","text":text}]}))
            .map_err(http_error)?;
        loop {
            heartbeat()?;
            if Instant::now() >= deadline {
                self.abort(session);
                return Err(WorklogError::new(
                    "MODEL_TIMEOUT",
                    "Report model request timed out",
                ));
            }
            let messages: Vec<Message> = self
                .agent
                .get(&format!(
                    "{}/session/{session}/message?limit=200",
                    self.endpoint.base_url
                ))
                .call()
                .map_err(http_error)?
                .into_json()
                .map_err(|_| wire_error())?;
            for message in messages {
                if message.info.role != "assistant"
                    || message.info.parent_id.as_deref() != Some(&message_id)
                {
                    continue;
                }
                if let Some(error) = message.info.error {
                    let code = match error.name.as_str() {
                        "ProviderAuthError" | "ModelNotFoundError" => "MODEL_CONFIGURATION",
                        _ => "MODEL_SERVICE_ERROR",
                    };
                    return Err(WorklogError::new(code, "Report model returned an error"));
                }
                if message.info.time.completed.is_some()
                    && message.info.finish.as_deref() == Some("stop")
                {
                    let result = message
                        .parts
                        .into_iter()
                        .filter_map(|part| match part {
                            Part::Text { text } => Some(text),
                            Part::Other => None,
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    return Ok(result);
                }
                if message.info.time.completed.is_some()
                    && message.info.finish.as_deref() == Some("length")
                {
                    return Err(wire_error());
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }
    pub fn abort(&self, session: &str) {
        let _result = self
            .agent
            .post(&format!(
                "{}/session/{session}/abort",
                self.endpoint.base_url
            ))
            .call();
    }
}
fn http_error(error: ureq::Error) -> WorklogError {
    let code = match error {
        ureq::Error::Status(401 | 403 | 404, _) => "MODEL_CONFIGURATION",
        ureq::Error::Status(_, _) | ureq::Error::Transport(_) => "MODEL_SERVICE_ERROR",
    };
    WorklogError::new(code, "Report model service request failed")
}
fn wire_error() -> WorklogError {
    WorklogError::new("INVALID_MODEL_OUTPUT", "Report model response is invalid")
}
#[cfg(test)]
#[path = "model_client_tests.rs"]
mod tests;
