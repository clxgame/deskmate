use super::opencode::{AgentEndpoint, OpenCodeClient, READY_TIMEOUT};
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
        auth_header: String::new(),
    })
}

fn read_request(stream: &mut std::net::TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    loop {
        let mut chunk = [0_u8; 2048];
        let count = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(str::trim)
                    .and_then(|value| value.parse::<usize>().ok())
            })
            .unwrap_or_default();
        if bytes.len() >= header_end + 4 + content_length {
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
            let request = read_request(&mut stream)?;
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
    assert!(client.wait_ready(READY_TIMEOUT));
    assert_eq!(client.create_session(Path::new("."))?, "session-ready");
    server.join().map_err(|_| "server join".to_owned())??;
    assert_eq!(
        *paths.lock().map_err(|_| "paths lock".to_owned())?,
        vec!["/global/health", "/global/health", "/session?directory=."]
    );
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
                let request = read_request(&mut stream)?;
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
