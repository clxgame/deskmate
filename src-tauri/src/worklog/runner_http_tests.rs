use super::super::{
    model_client::ModelEndpoint,
    repository::Repository,
    runner::{execute, RunnerEnvironment},
    storage::WorklogStore,
};
use chrono::Utc;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::AtomicBool,
};
struct Environment(ModelEndpoint);
impl RunnerEnvironment for Environment {
    fn endpoint(&self) -> Option<ModelEndpoint> {
        Some(self.0.clone())
    }
    fn changed(&self) {}
}
#[test]
fn runner_posts_to_real_http_and_commits_real_sqlite() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut parent = String::new();
        let mut references: Vec<String> = Vec::new();
        for step in 0..16 {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let read = socket.read(&mut buffer).unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let len = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            let body = if step == 0 {
                assert!(request.starts_with("GET /global/health"));
                r#"{"healthy":true}"#.to_owned()
            } else {
                match (step-1) % 5 {
                0=>r#"{"id":"ses_runner"}"#.to_owned(),1=>r#"["bash","worklog_record"]"#.to_owned(),
                2=>{let json:serde_json::Value=serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();parent=json["messageID"].as_str().unwrap().to_owned();assert_eq!(json["tools"]["bash"],false);let prompt=json["parts"][0]["text"].as_str().unwrap();assert!(prompt.chars().count()<=24000);assert!(prompt.starts_with("REPORT_KIND weekly"));references=["entry:entry:1","entry:extra0:1","entry:extra1:1","entry:extra2:1"].into_iter().filter(|key|prompt.contains(key)).map(str::to_owned).collect();String::new()},
                3=>serde_json::json!([{"info":{"role":"assistant","parentID":parent,"finish":"stop","time":{"completed":1}},"parts":[{"type":"text","text":serde_json::json!({"blocks":[{"heading":"本周成果（按项目）","text":"完成合成测试","sources":references},{"heading":"进展","text":"待补充","sources":[]},{"heading":"风险","text":"待补充","sources":[]},{"heading":"下周计划","text":"待补充","sources":[]}]}).to_string()}]}]).to_string(),
                4=>{assert!(request.starts_with("POST /session/ses_runner/abort"));"true".into()},_=>unreachable!(), }
            };
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    let path = std::env::temp_dir().join(format!("worklog-runner-{}.db", uuid::Uuid::new_v4()));
    {
        let repo = Repository::new(WorklogStore::open(&path).unwrap());
        repo.store.with_connection(|db|{
            db.execute("INSERT INTO work_entries(id,business_date,original_text,text,status,created_at,updated_at) VALUES('entry','2026-09-07','合成测试','完成合成测试','done',?1,?1)",[Utc::now().to_rfc3339()])?;
            for index in 0..3 { db.execute("INSERT INTO work_entries(id,business_date,original_text,text,status,created_at,updated_at) VALUES(?1,'2026-09-08','synthetic',?2,'done',?3,?3)",rusqlite::params![format!("extra{index}"),"中".repeat(8000),Utc::now().to_rfc3339()])?; }
            db.execute("INSERT INTO report_runs(id,kind,period_start,period_end,occurrence_key,state,model_id,created_at,updated_at) VALUES('run','weekly','2026-09-07','2026-09-11','fixture','queued','fixture/test',?1,?1)",[Utc::now().to_rfc3339()])?;Ok(())
        }).unwrap();
        let run = repo.claim_run(Utc::now()).unwrap().unwrap();
        execute(
            &repo,
            &run,
            (
                &Environment(ModelEndpoint {
                    base_url: format!("http://{address}"),
                    provider_id: "fixture".into(),
                    model_id: "test".into(),
                    epoch: "1".into(),
                }),
                &AtomicBool::new(false),
            ),
        )
        .unwrap();
    }
    server.join().unwrap();
    {
        let repo = Repository::new(WorklogStore::open(&path).unwrap());
        repo.store.with_connection(|db|{let(state,body):(String,String)=db.query_row("SELECT r.state,v.body_markdown FROM report_runs r JOIN reports p ON p.id=r.result_report_id JOIN report_versions v ON v.id=p.current_version_id",[],|row|Ok((row.get(0)?,row.get(1)?)))?;assert_eq!(state,"succeeded");assert!(body.contains("完成合成测试"));assert_eq!(db.query_row("SELECT count(*) FROM report_sources",[],|row|row.get::<_,i64>(0))?,4);Ok(())}).unwrap();
    }
    std::fs::remove_file(path).unwrap();
}
