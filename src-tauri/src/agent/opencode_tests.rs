use super::opencode::{AgentEndpoint, OpenCodeClient};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

fn client(port: u16) -> OpenCodeClient {
    OpenCodeClient::new(AgentEndpoint {
        base_url: format!("http://127.0.0.1:{port}"),
        provider_id: "provider".into(),
        model_id: "model".into(),
        workspace: Path::new(".").to_path_buf(),
    })
}

fn client_for(port: u16, workspace: &Path) -> OpenCodeClient {
    OpenCodeClient::new(AgentEndpoint {
        base_url: format!("http://127.0.0.1:{port}"),
        provider_id: "provider".into(),
        model_id: "model".into(),
        workspace: workspace.to_path_buf(),
    })
}

fn read_request(stream: &mut std::net::TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    loop {
        let mut buffer = [0_u8; 4096];
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..count]);
        let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if bytes.len() >= header_end + 4 + length {
            break;
        }
    }
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

#[test]
fn delayed_health_allows_one_session_create() -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let paths = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&paths);
    let server = std::thread::spawn(move || {
        let mut health_count = 0;
        loop {
            let (mut stream, _) = listener.accept().map_err(|error| error.to_string())?;
            let mut buffer = [0_u8; 2048];
            let count = stream
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            let request = String::from_utf8_lossy(&buffer[..count]);
            let path = request
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_owned();
            captured
                .lock()
                .map_err(|_| "paths lock".to_owned())?
                .push(path.clone());
            let (status, body) = if path == "/global/health" {
                health_count += 1;
                if health_count == 1 {
                    (503, "{}")
                } else {
                    (200, "{}")
                }
            } else {
                (200, "{\"id\":\"session-ready\"}")
            };
            write!(stream, "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len()).map_err(|error| error.to_string())?;
            stream.flush().map_err(|error| error.to_string())?;
            stream
                .shutdown(std::net::Shutdown::Write)
                .map_err(|error| error.to_string())?;
            if path.starts_with("/session?") {
                break;
            }
        }
        Ok::<(), String>(())
    });
    let client = client(port);
    assert!(client.wait_ready(Duration::from_secs(2)));
    assert_eq!(client.create_session(Path::new("."))?, "session-ready");
    server.join().map_err(|_| "server join".to_owned())??;
    assert_eq!(
        *paths.lock().map_err(|_| "paths lock".to_owned())?,
        vec!["/global/health", "/global/health", "/session?directory=."]
    );
    Ok(())
}

#[test]
fn workspace_directory_scopes_every_session_request() -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let server = std::thread::spawn(move || {
        for _ in 0..4 {
            let (mut stream, _) = listener.accept().map_err(|error| error.to_string())?;
            let request = read_request(&mut stream)?;
            let target = request
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_owned();
            let path = url::Url::parse(&format!("http://127.0.0.1{target}"))
                .map_err(|error| error.to_string())?
                .path()
                .to_owned();
            captured
                .lock()
                .map_err(|_| "requests lock".to_owned())?
                .push(request);
            let body = match path.as_str() {
                "/session" => "{\"id\":\"session-unicode\"}",
                "/session/session-unicode/message" => "[]",
                "/session/session-unicode/abort" => "true",
                _ => "{}",
            };
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len()).map_err(|error| error.to_string())?;
            stream.flush().map_err(|error| error.to_string())?;
            stream
                .shutdown(std::net::Shutdown::Write)
                .map_err(|error| error.to_string())?;
        }
        Ok::<(), String>(())
    });
    let workspace = Path::new("\\\\?\\E:\\工作 伙伴\\保留#?&%");
    let client = client_for(port, workspace);
    assert_eq!(client.create_session(workspace)?, "session-unicode");
    client.prompt("session-unicode", "message", "system", "input")?;
    assert!(client.snapshot("session-unicode")?.is_empty());
    assert!(client.abort("session-unicode")?);
    server.join().map_err(|_| "server join".to_owned())??;
    let requests = requests.lock().map_err(|_| "requests lock".to_owned())?;
    assert_eq!(requests.len(), 4);
    let create_body = requests[0]
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .ok_or_else(|| "missing create session body".to_owned())?;
    let create: serde_json::Value =
        serde_json::from_str(create_body).map_err(|error| error.to_string())?;
    assert_eq!(
        create.get("permission"),
        Some(&serde_json::json!([
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
        ]))
    );
    for request in requests.iter() {
        let target = request.split_whitespace().nth(1).unwrap_or_default();
        let url = url::Url::parse(&format!("http://127.0.0.1{target}"))
            .map_err(|error| error.to_string())?;
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "directory")
                .map(|(_, value)| value.into_owned()),
            Some("E:\\工作 伙伴\\保留#?&%".to_owned())
        );
        assert!(!request
            .to_ascii_lowercase()
            .contains("x-opencode-directory:"));
    }
    Ok(())
}

#[test]
fn never_ready_is_bounded_and_never_posts_session_or_prompt() -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let paths = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&paths);
    let server = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_millis(500);
        while std::time::Instant::now() < deadline {
            if let Ok((mut stream, _)) = listener.accept() {
                stream
                    .set_nonblocking(false)
                    .map_err(|error| error.to_string())?;
                stream
                    .set_read_timeout(Some(Duration::from_millis(100)))
                    .map_err(|error| error.to_string())?;
                let mut buffer = [0_u8; 2048];
                let count = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..count]);
                captured.lock().map_err(|_| "paths lock".to_owned())?.push(
                    request
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or_default()
                        .to_owned(),
                );
                write!(stream, "HTTP/1.1 503 Unavailable\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}") .map_err(|error| error.to_string())?;
            } else {
                std::thread::yield_now();
            }
        }
        Ok::<(), String>(())
    });
    assert!(!client(port).wait_ready(Duration::from_millis(250)));
    server.join().map_err(|_| "server join".to_owned())??;
    let seen = paths.lock().map_err(|_| "paths lock".to_owned())?;
    assert!(!seen.is_empty());
    assert!(seen.iter().all(|path| path == "/global/health"));
    Ok(())
}
