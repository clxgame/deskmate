use super::record_store::{NativeMessage, NativePart, NativeToolState};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[derive(Clone)]
pub(crate) struct AgentEndpoint {
    pub(crate) base_url: String,
    pub(crate) provider_id: String,
    pub(crate) model_id: String,
    pub(crate) workspace: std::path::PathBuf,
}
pub(crate) struct OpenCodeClient {
    endpoint: AgentEndpoint,
    agent: ureq::Agent,
}
#[derive(Deserialize)]
struct Session {
    id: String,
}
#[derive(Serialize)]
struct Model<'a> {
    #[serde(rename = "providerID")]
    provider_id: &'a str,
    #[serde(rename = "modelID")]
    model_id: &'a str,
}
#[derive(Deserialize)]
struct WireMessage {
    info: WireInfo,
    parts: Vec<WirePart>,
}
#[derive(Deserialize)]
struct WireInfo {
    id: String,
    #[serde(rename = "parentID")]
    parent_id: Option<String>,
    finish: Option<String>,
    time: WireTime,
    error: Option<WireError>,
}
#[derive(Deserialize)]
struct WireTime {
    completed: Option<u64>,
}
#[derive(Deserialize)]
struct WireError {
    name: String,
}
#[derive(Deserialize)]
struct WirePart {
    id: String,
    #[serde(rename = "callID")]
    call_id: Option<String>,
    tool: Option<String>,
    state: Option<WireToolState>,
}
#[derive(Deserialize)]
struct WireToolState {
    status: String,
    #[serde(default)]
    input: serde_json::Value,
    #[serde(default)]
    output: serde_json::Value,
    #[serde(default)]
    metadata: serde_json::Value,
}

impl OpenCodeClient {
    pub(crate) fn new(endpoint: AgentEndpoint) -> Self {
        Self {
            endpoint,
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(15))
                .build(),
        }
    }
    pub(crate) fn create_session(&self, workspace: &Path) -> Result<String, String> {
        debug_assert_eq!(workspace, self.endpoint.workspace);
        let session: Session = self
            .agent
            .post(&self.workspace_url("/session")?)
            .send_json(serde_json::json!({
                "title":"YUME Agent",
                "permission":[
                    {"permission":"read","pattern":"*","action":"ask"},
                    {"permission":"glob","pattern":"*","action":"ask"},
                    {"permission":"grep","pattern":"*","action":"ask"},
                    {"permission":"list","pattern":"*","action":"ask"},
                    {"permission":"write","pattern":"*","action":"ask"},
                    {"permission":"edit","pattern":"*","action":"ask"},
                    {"permission":"patch","pattern":"*","action":"ask"},
                    {"permission":"bash","pattern":"*","action":"ask"},
                    {"permission":"webfetch","pattern":"*","action":"deny"},
                    {"permission":"websearch","pattern":"*","action":"deny"}
                ]
            }))
            .map_err(http_error)?
            .into_json()
            .map_err(|_| "agent_wire_invalid")?;
        if session.id.is_empty() {
            return Err("agent_wire_invalid".into());
        }
        Ok(session.id)
    }
    pub(crate) fn wait_ready(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self
                .agent
                .get(&format!("{}/global/health", self.endpoint.base_url))
                .timeout(Duration::from_millis(500))
                .call()
                .is_ok()
            {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    }
    pub(crate) fn prompt(
        &self,
        session: &str,
        message_id: &str,
        system: &str,
        input: &str,
    ) -> Result<(), String> {
        self.agent.post(&self.workspace_url(&format!("/session/{session}/prompt_async"))?)
            .send_json(serde_json::json!({"messageID":message_id,"model":Model { provider_id:&self.endpoint.provider_id, model_id:&self.endpoint.model_id },"system":system,"parts":[{"type":"text","text":input}]}))
            .map_err(http_error)?;
        Ok(())
    }
    pub(crate) fn abort(&self, session: &str) -> Result<bool, String> {
        self.agent
            .post(&self.workspace_url(&format!("/session/{session}/abort"))?)
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|_| "agent_wire_invalid".into())
    }
    pub(crate) fn snapshot(&self, session: &str) -> Result<Vec<NativeMessage>, String> {
        let messages: Vec<WireMessage> = self
            .agent
            .get(&self.workspace_url(&format!("/session/{session}/message"))?)
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|_| "agent_wire_invalid")?;
        Ok(messages
            .into_iter()
            .map(|message| NativeMessage {
                id: message.info.id,
                parent_id: message.info.parent_id,
                completed: message.info.time.completed.is_some(),
                finish: message.info.finish,
                error: message.info.error.map(|error| error.name),
                parts: message
                    .parts
                    .into_iter()
                    .map(|part| NativePart {
                        id: part.id,
                        call_id: part.call_id,
                        tool: part.tool,
                        state: part.state.map(|state| NativeToolState {
                            status: state.status,
                            input: state.input,
                            output: state.output,
                            metadata: state.metadata,
                        }),
                    })
                    .collect(),
            })
            .collect())
    }

    fn workspace_url(&self, path: &str) -> Result<String, String> {
        let mut url = url::Url::parse(&format!("{}{path}", self.endpoint.base_url))
            .map_err(|_| "agent_endpoint_invalid".to_owned())?;
        url.query_pairs_mut().append_pair(
            "directory",
            &super::opencode_wire_directory(&self.endpoint.workspace),
        );
        Ok(url.into())
    }
}
fn http_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(status, _) => format!("agent_http_{status}"),
        ureq::Error::Transport(_) => "agent_transport_failure".into(),
    }
}
