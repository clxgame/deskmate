use super::{http_error, NativeMessage, OpenCodeClient};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SessionStatus {
    Idle,
    Busy,
    Retry,
}

#[derive(Deserialize)]
struct SettlementMessage {
    info: SettlementInfo,
    parts: Vec<Value>,
}

#[derive(Deserialize)]
struct SettlementInfo {
    id: String,
    #[serde(rename = "parentID")]
    parent_id: Option<String>,
}

#[derive(Deserialize)]
struct PendingInteraction {
    id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
}

impl OpenCodeClient {
    pub(crate) fn abort_with_interaction_cleanup(&self, session: &str) -> Result<(), String> {
        self.abort_confirmed(session)?;
        self.reject_pending(session, "permission")?;
        self.reject_pending(session, "question")?;
        if self.is_busy(session)? {
            self.abort_confirmed(session)?;
        }
        Ok(())
    }

    fn reject_pending(&self, session: &str, kind: &str) -> Result<(), String> {
        let pending = self.pending_interactions(kind)?;
        for request in pending
            .iter()
            .filter(|request| request.session_id == session)
        {
            if !crate::worklog::bridge::safe_id(&request.id) {
                return Err("agent_wire_invalid".to_owned());
            }
            let path = if kind == "permission" {
                format!("/permission/{}/reply", request.id)
            } else {
                format!("/question/{}/reject", request.id)
            };
            let call = self
                .agent
                .post(&self.workspace_url(&path)?)
                .set("Authorization", &self.endpoint.auth_header);
            let result = if kind == "permission" {
                call.send_json(json!({"reply":"reject"}))
            } else {
                call.call()
            };
            if let Err(error) = result {
                if !matches!(error, ureq::Error::Status(404, _)) {
                    return Err(http_error(error));
                }
            }
        }
        if self
            .pending_interactions(kind)?
            .iter()
            .any(|request| request.session_id == session)
        {
            return Err("agent_abort_interaction_cleanup_failed".to_owned());
        }
        Ok(())
    }

    fn pending_interactions(&self, kind: &str) -> Result<Vec<PendingInteraction>, String> {
        self.agent
            .get(&self.workspace_url(&format!("/{kind}"))?)
            .set("Authorization", &self.endpoint.auth_header)
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|_| "agent_wire_invalid".to_owned())
    }

    pub(crate) fn abort_confirmed(&self, session: &str) -> Result<(), String> {
        if !self.abort(session)? {
            return Err("agent_abort_unconfirmed".into());
        }
        if self.is_busy(session)? {
            return Err("agent_abort_still_running".into());
        }
        Ok(())
    }

    pub(crate) fn is_busy(&self, session: &str) -> Result<bool, String> {
        let states: HashMap<String, SessionStatus> = self
            .agent
            .get(&self.workspace_url("/session/status")?)
            .set("Authorization", &self.endpoint.auth_header)
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|_| "agent_wire_invalid")?;
        Ok(match states.get(session) {
            Some(SessionStatus::Busy | SessionStatus::Retry) => true,
            Some(SessionStatus::Idle) | None => false,
        })
    }

    pub(crate) fn settle_tools(
        &self,
        session: &str,
        run_id: &str,
        reason: &str,
    ) -> Result<Vec<NativeMessage>, String> {
        self.abort_confirmed(session)?;
        let messages: Vec<SettlementMessage> = self
            .agent
            .get(&self.workspace_url(&format!("/session/{session}/message"))?)
            .set("Authorization", &self.endpoint.auth_header)
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|_| "agent_wire_invalid")?;
        for message in messages
            .into_iter()
            .filter(|message| message.info.parent_id.as_deref() == Some(run_id))
        {
            for mut part in message.parts {
                if part.get("type").and_then(Value::as_str) != Some("tool") {
                    continue;
                }
                match part.pointer("/state/status").and_then(Value::as_str) {
                    Some("pending" | "running") => {}
                    Some("completed" | "error") => continue,
                    _ => return Err("agent_wire_invalid".into()),
                }
                let part_id = part
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or("agent_wire_invalid")?
                    .to_owned();
                let input = part
                    .pointer("/state/input")
                    .ok_or("agent_wire_invalid")?
                    .clone();
                let end = chrono::Utc::now().timestamp_millis();
                let start = part
                    .pointer("/state/time/start")
                    .cloned()
                    .unwrap_or_else(|| json!(end));
                part["state"] = json!({"status":"error","input":input,"error":reason,"time":{"start":start,"end":end}});
                self.agent
                    .patch(&self.workspace_url(&format!(
                        "/session/{session}/message/{}/part/{part_id}",
                        message.info.id
                    ))?)
                    .set("Authorization", &self.endpoint.auth_header)
                    .send_json(part)
                    .map_err(http_error)?;
            }
        }
        self.snapshot(session)
    }
}
