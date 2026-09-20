use super::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
};

#[test]
fn scoped_path_request_falls_back_to_stream_and_defaults_missing_path() {
    // Given: OpenCode's list endpoint rejects a glob request whose metadata omits path,
    // while the same request is available on the live event stream.
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
    let base = format!("http://{}", listener.local_addr().expect("fixture address"));
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut request = [0_u8; 1024];
        let count = stream.read(&mut request).expect("read request");
        assert!(count > 0, "request must not be empty");
        let body =
            r#"{"error":"Expected JSON value, got undefined at [0][\"metadata\"][\"path\"]"}"#;
        write!(
            stream,
            "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .expect("write response");
        stream.flush().expect("flush response");
        stream
            .shutdown(std::net::Shutdown::Write)
            .expect("finish response");
    });
    let root = std::env::temp_dir().join(format!(
        "yume-permission-default-path-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("create workspace");
    let events = PermissionEvents::default();
    events.accept(json!({
        "type":"permission.asked",
        "properties":{
            "id":"p-glob",
            "sessionID":"s-owned",
            "permission":"glob",
            "patterns":["**/*snake*"],
            "metadata":{"pattern":"**/*snake*"}
        }
    }));
    events.state.lock().expect("lock stream").connected = true;
    let workspace = root.canonicalize().expect("canonical workspace");

    // When: the scoped Agent boundary collects pending permissions.
    let requests = events
        .pending_scoped(&base, &workspace, "s-owned")
        .expect("recover request from stream");

    // Then: the host workspace is supplied as the missing path.
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].metadata["path"],
        json!(crate::agent::opencode_wire_directory(&workspace))
    );
    server.join().expect("server finished");
    std::fs::remove_dir_all(root).expect("remove workspace");
}
