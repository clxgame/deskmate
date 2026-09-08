use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

#[test]
fn real_http_fixture_requires_terminal_completion_and_disables_tools() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut message_id = String::new();
        for step in 0..5 {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let read = socket.read(&mut buffer).unwrap();
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(end) = bytes.windows(4).position(|chunk| chunk == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            let body=match step {
                0=>{assert!(request.starts_with("POST /session "));r#"{"id":"ses_fixture"}"#.to_owned()},
                1=>{assert!(request.starts_with("GET /experimental/tool/ids"));r#"["bash","worklog_record"]"#.to_owned()},
                2=>{
                    assert!(request.starts_with("POST /session/ses_fixture/prompt_async"));
                    let input:serde_json::Value=serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
                    assert_eq!(input["tools"]["bash"],false);assert_eq!(input["tools"]["worklog_record"],false);
                    message_id=input["messageID"].as_str().unwrap().into();String::new()
                },
                3=>serde_json::json!([{"info":{"role":"assistant","parentID":message_id,"finish":"tool-calls","time":{"completed":1}},"parts":[{"type":"text","text":"partial"}]}]).to_string(),
                4=>serde_json::json!([{"info":{"role":"assistant","parentID":message_id,"finish":"stop","time":{"completed":2}},"parts":[{"type":"text","text":"complete"}]}]).to_string(),
                _=>unreachable!(),
            };
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    let client = ModelClient::new(ModelEndpoint {
        base_url: format!("http://{address}"),
        provider_id: "fixture".into(),
        model_id: "test".into(),
        epoch: "1".into(),
    });
    let session = client.create_session().unwrap();
    assert_eq!(
        client
            .generate((&session, "synthetic sources"), || Ok(()))
            .unwrap(),
        "complete"
    );
    server.join().unwrap();
}
