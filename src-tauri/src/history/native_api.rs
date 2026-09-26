#[path = "native_api_types.rs"]
mod types;
use super::catalog_model::canonical_directory;
use serde::de::DeserializeOwned;
use std::{collections::HashMap, error::Error, io::Read, time::Duration};
pub(crate) use types::{NativeApiError, NativeSession, NativeStatus};

pub(crate) struct NativeHistoryClient {
    base_url: url::Url,
    auth_header: String,
    agent: ureq::Agent,
}

pub(crate) struct NativeTextPreview {
    pub(crate) message: Option<super::HistoryMessage>,
    pub(crate) exhausted: bool,
}

pub(crate) fn authorize_history_window(label: &str) -> Result<(), NativeApiError> {
    match label {
        "chat" | "workbench" => Ok(()),
        _ => Err(NativeApiError::Forbidden),
    }
}

impl NativeHistoryClient {
    /// Fetch only the newest text messages for a history-row preview. The
    /// ordinary transcript loader deliberately remains unrestricted.
    pub(crate) fn preview_text(
        &self,
        directory: &str,
        id: &str,
    ) -> Result<NativeTextPreview, NativeApiError> {
        #[derive(serde::Deserialize)]
        struct Time {
            created: Option<u64>,
        }
        #[derive(serde::Deserialize)]
        struct Info {
            id: String,
            role: Option<String>,
            time: Time,
        }
        #[derive(serde::Deserialize)]
        struct Part {
            id: String,
            #[serde(rename = "type")]
            kind: Option<String>,
            text: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct Message {
            info: Info,
            parts: Vec<Part>,
        }

        // The pinned sidecar returns the newest `limit` messages in ascending
        // order and exposes older pages via X-Next-Cursor.
        let route = format!("{}/message", Self::session_route(id)?);
        let mut cursor: Option<String> = None;
        for _ in 0..2 {
            let mut request = self
                .request("GET", directory, &route)?
                .query("limit", "8")
                .timeout(Duration::from_secs(2));
            if let Some(before) = cursor.as_deref() {
                request = request.query("before", before);
            }
            let response = request.call().map_err(http_error)?;
            cursor = response.header("x-next-cursor").map(ToOwned::to_owned);
            let mut bytes = Vec::new();
            response
                .into_reader()
                .take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| NativeApiError::InvalidResponse)?;
            if bytes.len() > 8 * 1024 * 1024 {
                return Err(NativeApiError::Incomplete);
            }
            let messages: Vec<Message> =
                serde_json::from_slice(&bytes).map_err(|_| NativeApiError::InvalidResponse)?;
            for message in messages.into_iter().rev() {
                let role = message.info.role.unwrap_or_default();
                if !matches!(role.as_str(), "user" | "assistant") {
                    continue;
                }
                let text = message
                    .parts
                    .iter()
                    .filter(|part| part.kind.as_deref() == Some("text"))
                    .filter_map(|part| part.text.as_deref())
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                if !text.is_empty() {
                    return Ok(NativeTextPreview {
                        message: Some(super::HistoryMessage {
                            local_only: false,
                            role,
                            text,
                            time: message.info.time.created.unwrap_or(0),
                            message_id: Some(message.info.id),
                            part_id: message
                                .parts
                                .iter()
                                .find(|part| part.kind.as_deref() == Some("text"))
                                .map(|part| part.id.clone()),
                        }),
                        exhausted: cursor.is_none(),
                    });
                }
            }
            if cursor.is_none() {
                break;
            }
        }
        Ok(NativeTextPreview {
            message: None,
            exhausted: cursor.is_none(),
        })
    }

    pub(crate) fn verify_preview_session(
        &self,
        directory: &str,
        id: &str,
    ) -> Result<(), NativeApiError> {
        let response = self
            .request("GET", directory, &Self::session_route(id)?)?
            .timeout(Duration::from_secs(2))
            .call()
            .map_err(http_error)?;
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| NativeApiError::InvalidResponse)?;
        if bytes.len() > 64 * 1024 {
            return Err(NativeApiError::Incomplete);
        }
        let row = serde_json::from_slice(&bytes).map_err(|_| NativeApiError::InvalidResponse)?;
        Self::scoped(row, directory, Some(id))?;
        Ok(())
    }
    pub(crate) fn new(base_url: &str, auth_header: &str) -> Result<Self, NativeApiError> {
        let base_url = url::Url::parse(base_url).map_err(|_| NativeApiError::InvalidRequest)?;
        if base_url.scheme() != "http"
            || base_url.host_str() != Some("127.0.0.1")
            || base_url.port().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.path() != "/"
            || base_url.query().is_some()
            || base_url.fragment().is_some()
            || !auth_header.starts_with("Basic ")
            || auth_header.chars().any(char::is_control)
        {
            return Err(NativeApiError::InvalidRequest);
        }
        Ok(Self {
            base_url,
            auth_header: auth_header.to_owned(),
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(5))
                .redirects(0)
                .build(),
        })
    }

    fn request(
        &self,
        method: &str,
        directory: &str,
        route: &str,
    ) -> Result<ureq::Request, NativeApiError> {
        canonical_directory(directory).map_err(|_| NativeApiError::InvalidRequest)?;
        let mut url = self.base_url.clone();
        url.set_path(route);
        url.query_pairs_mut().append_pair("directory", directory);
        Ok(self
            .agent
            .request(method, url.as_str())
            .set("Authorization", &self.auth_header))
    }

    fn session_route(id: &str) -> Result<String, NativeApiError> {
        if !crate::worklog::bridge::safe_id(id) {
            return Err(NativeApiError::InvalidRequest);
        }
        Ok(format!("/session/{id}"))
    }

    fn scoped(
        session: NativeSession,
        directory: &str,
        id: Option<&str>,
    ) -> Result<NativeSession, NativeApiError> {
        let expected =
            canonical_directory(directory).map_err(|_| NativeApiError::InvalidRequest)?;
        let actual =
            canonical_directory(&session.directory).map_err(|_| NativeApiError::InvalidResponse)?;
        if actual != expected || id.is_some_and(|id| id != session.id) {
            return Err(NativeApiError::ScopeMismatch);
        }
        Self::session_route(&session.id).map_err(|_| NativeApiError::InvalidResponse)?;
        Ok(session)
    }

    pub(crate) fn list_all(&self, directory: &str) -> Result<Vec<NativeSession>, NativeApiError> {
        let mut limit = 100;
        loop {
            let rows: Vec<NativeSession> = decode(
                self.request("GET", directory, "/session")?
                    .query("roots", "true")
                    .query("limit", &limit.to_string())
                    .call(),
            )?;
            let complete = rows.len() < limit;
            let rows = rows
                .into_iter()
                .map(|row| Self::scoped(row, directory, None))
                .collect::<Result<Vec<_>, _>>()?;
            if complete {
                return Ok(rows);
            }
            if limit >= 51_200 {
                return Err(NativeApiError::Incomplete);
            }
            limit *= 2;
        }
    }

    pub(crate) fn get(&self, directory: &str, id: &str) -> Result<NativeSession, NativeApiError> {
        let row = decode(
            self.request("GET", directory, &Self::session_route(id)?)?
                .call(),
        )?;
        Self::scoped(row, directory, Some(id))
    }

    pub(crate) fn statuses(
        &self,
        directory: &str,
    ) -> Result<HashMap<String, NativeStatus>, NativeApiError> {
        decode(self.request("GET", directory, "/session/status")?.call())
    }

    pub(crate) fn resolve_known_session(
        &self,
        directories: &[String],
        id: &str,
    ) -> Result<NativeSession, NativeApiError> {
        let directory = directories.first().ok_or(NativeApiError::InvalidRequest)?;
        let row: NativeSession = decode(
            self.request("GET", directory, &Self::session_route(id)?)?
                .call(),
        )?;
        let actual =
            canonical_directory(&row.directory).map_err(|_| NativeApiError::InvalidResponse)?;
        if row.parent_id.is_some()
            || !directories
                .iter()
                .any(|known| canonical_directory(known).is_ok_and(|known| known == actual))
        {
            return Err(NativeApiError::ScopeMismatch);
        }
        Self::scoped(row, &actual, Some(id))
    }

    pub(crate) fn rename(
        &self,
        directory: &str,
        id: &str,
        title: &str,
    ) -> Result<NativeSession, NativeApiError> {
        if title.trim().is_empty() || title.len() > 1000 {
            return Err(NativeApiError::InvalidRequest);
        }
        self.patch(directory, id, serde_json::json!({"title":title}))
    }

    #[cfg(test)]
    pub(crate) fn archive(
        &self,
        directory: &str,
        id: &str,
        timestamp: Option<u64>,
    ) -> Result<NativeSession, NativeApiError> {
        let timestamp = timestamp.ok_or(NativeApiError::UnsupportedRestore)?;
        self.patch(
            directory,
            id,
            serde_json::json!({"time":{"archived":timestamp}}),
        )
    }

    fn patch(
        &self,
        directory: &str,
        id: &str,
        body: serde_json::Value,
    ) -> Result<NativeSession, NativeApiError> {
        self.get(directory, id)?;
        let row = decode(
            self.request("PATCH", directory, &Self::session_route(id)?)?
                .send_json(body),
        )?;
        Self::scoped(row, directory, Some(id))
    }

    pub(crate) fn delete(&self, directory: &str, id: &str) -> Result<(), NativeApiError> {
        match self.get(directory, id) {
            Err(NativeApiError::Missing) => return Ok(()),
            result => {
                result?;
            }
        }
        let removed: bool = decode(
            self.request("DELETE", directory, &Self::session_route(id)?)?
                .call(),
        )?;
        if !removed {
            return Err(NativeApiError::InvalidResponse);
        }
        match self.get(directory, id) {
            Err(NativeApiError::Missing) => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Err(NativeApiError::Incomplete),
        }
    }
}

fn decode<T: DeserializeOwned>(
    response: Result<ureq::Response, ureq::Error>,
) -> Result<T, NativeApiError> {
    let response = response.map_err(http_error)?;
    if !(200..300).contains(&response.status()) {
        return Err(NativeApiError::Http(response.status()));
    }
    response
        .into_json()
        .map_err(|_| NativeApiError::InvalidResponse)
}

fn http_error(error: ureq::Error) -> NativeApiError {
    match error {
        ureq::Error::Status(401, _) => NativeApiError::Unauthorized,
        ureq::Error::Status(404, _) => NativeApiError::Missing,
        ureq::Error::Status(status, _) => NativeApiError::Http(status),
        ureq::Error::Transport(error) => {
            let mut cause = error.source();
            while let Some(current) = cause {
                if current
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| {
                        matches!(
                            error.kind(),
                            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                        )
                    })
                {
                    return NativeApiError::Timeout;
                }
                cause = current.source();
            }
            NativeApiError::Unavailable
        }
    }
}

#[path = "reconcile_tests.rs"]
#[cfg(test)]
mod reconciliation_tests;
#[path = "native_api_tests.rs"]
#[cfg(test)]
mod tests;
