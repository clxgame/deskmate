use super::super::model_client::ModelEndpoint;
use super::super::runner::{execute, RunnerEnvironment};
use super::tests::{fixture, now};
use std::sync::atomic::AtomicBool;
struct Unconfigured;
impl RunnerEnvironment for Unconfigured {
    fn endpoint(&self) -> Option<ModelEndpoint> {
        panic!("Missing configuration must fail before service lookup")
    }
    fn changed(&self) {}
}
#[test]
fn missing_model_is_a_visible_persisted_failure() {
    let repo = fixture();
    repo.store
        .with_connection(|db| {
            db.execute("UPDATE report_runs SET model_id=''", [])?;
            Ok(())
        })
        .unwrap();
    let run = repo.claim_run(now()).unwrap().unwrap();
    let error = execute(&repo, &run, (&Unconfigured, &AtomicBool::new(false))).unwrap_err();
    assert_eq!(error.code, "MODEL_CONFIGURATION");
    repo.fail_run(&run, (&error, now())).unwrap();
    repo.store
        .with_connection(|db| {
            let (state, code): (String, String) =
                db.query_row("SELECT state,error_code FROM report_runs", [], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?;
            assert_eq!(state, "failed");
            assert_eq!(code, "MODEL_CONFIGURATION");
            Ok(())
        })
        .unwrap();
}
