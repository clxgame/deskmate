use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

pub(super) fn serve(
    responses: Vec<(u16, String)>,
) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        responses.into_iter().map(|(status, body)| {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
            let request = read_request(&mut stream);
            write!(stream,"HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            request
        }).collect()
    });
    (url, worker)
}

pub(super) fn session(id: &str, directory: &str) -> String {
    serde_json::json!({"id":id,"title":"synthetic","directory":directory,"time":{"created":1,"updated":2}}).to_string()
}

#[test]
fn wrong_window_is_denied_before_any_sidecar_access() {
    // Given an unrelated renderer.
    // When it requests the history boundary.
    let result = authorize_history_window("settings");
    // Then no history access is granted.
    assert_eq!(result, Err(NativeApiError::Forbidden));
}

#[test]
fn bounded_preview_uses_recent_text_and_excludes_tool_parts() {
    let body = serde_json::json!([
        {"info":{"id":"msg_old","role":"user","time":{"created":1}},"parts":[{"id":"p1","type":"text","text":"Earlier question"}]},
        {"info":{"id":"msg_latest","role":"assistant","time":{"created":2}},"parts":[
            {"id":"p2","type":"tool","text":"private tool result"},
            {"id":"p3","type":"text","text":"Actual reply"}
        ]}
    ]).to_string();
    let (url, worker) = serve(vec![(200, body)]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    let preview = client.preview_text("C:/allowed", "ses_one").unwrap();
    assert!(preview.exhausted);
    assert_eq!(preview.message.unwrap().text, "Actual reply");
    let requests = worker.join().unwrap();
    assert!(
        requests[0].starts_with("GET /session/ses_one/message?directory=C%3A%2Fallowed&limit=8 ")
    );
}

#[test]
fn preview_metadata_requires_the_requested_directory() {
    let (url, worker) = serve(vec![(200, session("ses_one", "C:/other"))]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    assert_eq!(
        client.verify_preview_session("C:/allowed", "ses_one"),
        Err(NativeApiError::ScopeMismatch)
    );
    worker.join().unwrap();
}

#[test]
fn resolve_known_session_accepts_actual_directory_from_another_known_project() {
    let (url, worker) = serve(vec![(200, session("ses_one", "C:/other"))]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    let row = client.resolve_known_session(&["C:/default".into(), "C:/other".into()], "ses_one");
    worker.join().unwrap();
    assert_eq!(row.unwrap().directory, "C:/other");
}

#[test]
fn resolve_known_session_rejects_unknown_scope_and_children() {
    for body in [session("ses_one", "C:/unknown"), serde_json::json!({"id":"ses_one","parentID":"ses_parent","title":"child","directory":"C:/known","time":{"created":1,"updated":2}}).to_string()] {
        let (url, worker) = serve(vec![(200, body)]);
        let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
        let result = client.resolve_known_session(&["C:/known".into()], "ses_one");
        worker.join().unwrap();
        assert!(result.is_err());
    }
}

#[test]
fn cross_directory_get_is_rejected_even_when_sidecar_returns_success() {
    // Given upstream get does not authorize the requested directory.
    let (url, worker) = serve(vec![(200, session("ses_one", "C:/other"))]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When another directory is requested.
    let result = client.get("C:/allowed", "ses_one");
    // Then the host rejects the mismatched identity.
    assert_eq!(result.unwrap_err(), NativeApiError::ScopeMismatch);
    worker.join().unwrap();
}

#[test]
fn authentication_failure_has_a_typed_redacted_error() {
    // Given a response that could contain private data.
    let (url, worker) = serve(vec![(401, "secret response".into())]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When authorization fails.
    let error = client.get("C:/allowed", "ses_one").unwrap_err();
    // Then neither credentials nor response content are returned.
    assert_eq!(error, NativeApiError::Unauthorized);
    assert_eq!(error.to_string(), "history_native_unauthorized");
    worker.join().unwrap();
}

#[test]
fn adaptive_listing_keeps_all_1001_rows_with_equal_timestamps() {
    // Given five growing response prefixes with equal timestamps.
    let all: Vec<serde_json::Value> = (0..1001)
        .map(|i| serde_json::from_str(&session(&format!("ses_{i}"), "C:/allowed")).unwrap())
        .collect();
    let responses = [100, 200, 400, 800, 1600]
        .into_iter()
        .map(|limit| {
            (
                200,
                serde_json::to_string(&all[..all.len().min(limit)]).unwrap(),
            )
        })
        .collect();
    let (url, worker) = serve(responses);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When the complete list is requested.
    let rows = client.list_all("C:/allowed").unwrap();
    // Then a timestamp tie cannot discard a boundary row.
    assert_eq!(rows.len(), 1001);
    assert_eq!(worker.join().unwrap().len(), 5);
}

#[test]
fn missing_session_has_an_explicit_error() {
    // Given a deleted session.
    let (url, worker) = serve(vec![(404, "{}".into())]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When its metadata is requested.
    let result = client.get("C:/allowed", "ses_missing");
    // Then missing is distinguishable from outage.
    assert_eq!(result.unwrap_err(), NativeApiError::Missing);
    worker.join().unwrap();
}

#[test]
fn disconnected_sidecar_is_unavailable() {
    // Given a local port with no listener.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When metadata is requested.
    let result = client.get("C:/allowed", "ses_one");
    // Then an outage is not an empty history.
    assert_eq!(result.unwrap_err(), NativeApiError::Unavailable);
}

#[test]
fn stalled_sidecar_has_a_bounded_timeout() {
    // Given a sidecar that accepts the connection but never responds.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (release, hold) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        hold.recv().unwrap();
        drop(stream);
    });
    let mut client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    client.agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(30))
        .build();
    // When the bounded request expires.
    let result = client.get("C:/allowed", "ses_one");
    release.send(()).unwrap();
    worker.join().unwrap();
    // Then callers receive a distinct timeout without a transport string.
    assert_eq!(result.unwrap_err(), NativeApiError::Timeout);
}

#[test]
fn successful_rename_uses_basic_auth_and_patch() {
    // Given a scoped session returned before and after update.
    let row = session("ses_one", "C:/allowed");
    let (url, worker) = serve(vec![(200, row.clone()), (200, row)]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When its title is updated.
    client.rename("C:/allowed", "ses_one", "Renamed").unwrap();
    // Then the host uses authenticated scoped requests.
    let requests = worker.join().unwrap();
    assert!(requests[1].starts_with("PATCH /session/ses_one?directory=C%3A%2Fallowed "));
    assert!(requests
        .iter()
        .all(|request| request.contains("Authorization: Basic synthetic")));
}

#[test]
fn permanent_delete_requires_observed_removal() {
    // Given upstream reports delete success while the session still exists.
    let row = session("ses_one", "C:/allowed");
    let (url, worker) = serve(vec![(200, row.clone()), (200, "true".into()), (200, row)]);
    let client = NativeHistoryClient::new(&url, "Basic synthetic").unwrap();
    // When deletion is attempted.
    let result = client.delete("C:/allowed", "ses_one");
    // Then a durable tombstone must remain retryable.
    assert_eq!(result, Err(NativeApiError::Incomplete));
    worker.join().unwrap();
}

#[test]
fn restore_is_rejected_without_sending_an_invalid_archive_value() {
    // Given the pinned API has no supported native archive clearing operation.
    let client = NativeHistoryClient::new("http://127.0.0.1:12345", "Basic synthetic").unwrap();
    // When restoration is requested.
    let result = client.archive("C:/allowed", "ses_one", None);
    // Then no zero/null/no-op request is mistaken for restoration.
    assert_eq!(result.unwrap_err(), NativeApiError::UnsupportedRestore);
}

#[test]
fn a_redirect_cannot_relay_the_sidecar_credential() {
    // Given an unapproved destination and a session ID containing a route.
    // When endpoint and route boundaries are parsed.
    let invalid_endpoint = NativeHistoryClient::new("http://example.com:8080", "Basic synthetic");
    let invalid_id = NativeHistoryClient::session_route("../global");
    // Then neither can become an authenticated request.
    assert!(matches!(
        invalid_endpoint,
        Err(NativeApiError::InvalidRequest)
    ));
    assert_eq!(invalid_id, Err(NativeApiError::InvalidRequest));
}

fn read_request(reader: &mut impl Read) -> String {
    let mut request = Vec::new();
    let mut byte = [0_u8; 1];
    while !request.ends_with(b"\r\n\r\n") {
        reader.read_exact(&mut byte).unwrap();
        request.push(byte[0]);
        assert!(request.len() <= 65536);
    }
    let header = String::from_utf8(request.clone()).unwrap();
    let body_length: usize = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("Content-Length")
                .then(|| value.trim().parse().unwrap())
        })
        .unwrap_or(0);
    let header_length = request.len();
    request.resize(header_length + body_length, 0);
    reader.read_exact(&mut request[header_length..]).unwrap();
    String::from_utf8(request).unwrap()
}
#[test]
fn wire_fixture_reads_fragmented_headers_and_body_completely() {
    struct Fragmented(std::io::Cursor<Vec<u8>>);
    impl Read for Fragmented {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let size = buffer.len().min(7);
            self.0.read(&mut buffer[..size])
        }
    }
    // Given a request fragmented across arbitrary transport reads.
    let request = "PATCH /session/ses_one HTTP/1.1\r\nContent-Length: 7\r\n\r\n{\"a\":1}";
    let mut reader = Fragmented(std::io::Cursor::new(request.as_bytes().to_vec()));
    // When the HTTP fixture consumes the request before replying.
    let read = read_request(&mut reader);
    // Then it consumes the complete body rather than resetting an in-flight upload.
    assert_eq!(read, request);
}
