use super::super::{
    model_client::ModelEndpoint,
    repository::Repository,
    runner::{execute, RunnerEnvironment},
    storage::WorklogStore,
};
use chrono::Utc;
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc},
    time::{Duration, Instant},
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
                    auth_header: String::new(),
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

#[test]
#[ignore = "requires the P4 shared-service OpenCode runtime"]
fn shared_service_report_live() {
    let base_url = std::env::var("YUME_P4_MATRIX_BASE").expect("matrix base");
    let workspace =
        PathBuf::from(std::env::var("YUME_P4_MATRIX_WORKSPACE").expect("matrix workspace"));
    let coordination =
        PathBuf::from(std::env::var("YUME_P4_MATRIX_COORDINATION").expect("matrix coordination"));
    let database = workspace.join(format!("p4-report-{}.db", uuid::Uuid::new_v4()));
    let repo = Arc::new(Repository::new(WorklogStore::open(&database).unwrap()));
    let now = Utc::now().to_rfc3339();
    repo.store.with_connection(|db| {
        db.execute("INSERT INTO work_entries(id,business_date,project,original_text,text,status,created_at,updated_at) VALUES('p4-entry','2026-09-23','P4','共享服务并发验收','共享服务并发验收','done',?1,?1)",[&now])?;
        db.execute("INSERT INTO report_runs(id,kind,period_start,period_end,occurrence_key,state,model_id,created_at,updated_at) VALUES('p4-matrix-report','weekly','2026-09-23','2026-09-23','manual:p4-matrix','queued','yume/model-a',?1,?1)",[&now])?;
        Ok(())
    }).unwrap();
    let run = repo.claim_run(Utc::now()).unwrap().unwrap();
    let worker_repo = repo.clone();
    let worker_run = run.clone();
    let worker_base = base_url.clone();
    let worker = std::thread::spawn(move || {
        execute(
            &worker_repo,
            &worker_run,
            (
                &Environment(ModelEndpoint {
                    base_url: worker_base,
                    provider_id: "yume".into(),
                    model_id: "model-a".into(),
                    epoch: "p4-matrix".into(),
                    auth_header: String::new(),
                }),
                &AtomicBool::new(false),
            ),
        )
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    let session_id = loop {
        let session = repo
            .list_runs()
            .unwrap()
            .into_iter()
            .find(|item| item.id == run.id)
            .and_then(|item| item.session_id);
        if let Some(session) = session {
            break session;
        }
        assert!(Instant::now() < deadline, "report session was not created");
        std::thread::sleep(Duration::from_millis(25));
    };
    fs::write(
        &coordination,
        serde_json::to_vec_pretty(&serde_json::json!({
            "phase": "running", "runId": run.id, "sessionId": session_id,
        }))
        .unwrap(),
    )
    .unwrap();
    worker.join().unwrap().unwrap();
    let (state, stored_session, body): (String, String, String) = repo.store.with_connection(|db| {
        Ok(db.query_row(
            "SELECT r.state,r.session_id,v.body_markdown FROM report_runs r JOIN reports p ON p.id=r.result_report_id JOIN report_versions v ON v.id=p.current_version_id WHERE r.id='p4-matrix-report'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?)
    }).unwrap();
    assert_eq!(state, "succeeded");
    assert_eq!(stored_session, session_id);
    assert!(body.contains("完成共享服务并发验收"));
    fs::write(
        &coordination,
        serde_json::to_vec_pretty(&serde_json::json!({
            "phase": "completed", "runId": run.id, "sessionId": session_id,
            "state": state, "body": body,
        }))
        .unwrap(),
    )
    .unwrap();
    drop(repo);
    let _ = fs::remove_file(&database);
    let _ = fs::remove_file(database.with_extension("db-wal"));
    let _ = fs::remove_file(database.with_extension("db-shm"));
}
