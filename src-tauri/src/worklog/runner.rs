use super::{
    error::{WorklogError, WorklogResult},
    model_client::{ModelClient, ModelEndpoint},
    reports,
    repository::Repository,
    repository_runtime::ClaimedRun,
};
use chrono::{Datelike, Duration as ChronoDuration, NaiveDate, Utc};
use std::collections::BTreeSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

pub trait RunnerEnvironment: Send + Sync {
    fn endpoint(&self) -> Option<ModelEndpoint>;
    fn changed(&self);
    fn model_identity(&self) -> Option<String> {
        self.endpoint()
            .map(|endpoint| format!("{}/{}", endpoint.provider_id, endpoint.model_id))
    }
}
pub struct RunnerHandle {
    stop: Arc<AtomicBool>,
}
impl RunnerHandle {
    pub fn start(repository: Arc<Repository>, environment: Arc<dyn RunnerEnvironment>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        std::thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                let identity = environment.model_identity().unwrap_or_default();
                if let Err(error) = repository.enqueue_due(Utc::now(), &identity) {
                    eprintln!("worklog scheduler: {}", error.code);
                }
                match repository.claim_run(Utc::now()) {
                    Ok(Some(run)) => {
                        let outcome = execute(&repository, &run, (&*environment, &worker_stop));
                        if let Err(error) = outcome {
                            if let Err(persist_error) =
                                repository.fail_run(&run, (&error, Utc::now()))
                            {
                                eprintln!("worklog runner persistence: {}", persist_error.code);
                            }
                        }
                        environment.changed();
                    }
                    Ok(None) => {}
                    Err(error) => eprintln!("worklog claim: {}", error.code),
                }
                for _ in 0..10 {
                    if worker_stop.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        });
        Self { stop }
    }
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
impl Drop for RunnerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn execute(
    repository: &Repository,
    run: &ClaimedRun,
    context: (&dyn RunnerEnvironment, &AtomicBool),
) -> WorklogResult<()> {
    let (environment, stop) = context;
    let cutoff_date = chrono::Local::now().date_naive();
    if run.sources.is_empty() {
        repository.publish_run(run, ("", Utc::now()))?;
        return Ok(());
    }
    if run.model_id.is_empty() {
        return Err(WorklogError::new(
            "MODEL_CONFIGURATION",
            "Configure a report model, then retry this run",
        ));
    }
    let wait_started = Instant::now();
    let endpoint = loop {
        if stop.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        if let Some(endpoint) = environment.endpoint() {
            let remaining = Duration::from_secs(30).saturating_sub(wait_started.elapsed());
            if !remaining.is_zero()
                && ModelClient::new(endpoint.clone()).ready(remaining.min(Duration::from_secs(2)))
            {
                break endpoint;
            }
        }
        if wait_started.elapsed() >= Duration::from_secs(30) {
            return Err(WorklogError::new(
                "SIDECAR_UNAVAILABLE",
                "Report service is not ready",
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    };
    if format!("{}/{}", endpoint.provider_id, endpoint.model_id) != run.model_id {
        return Err(WorklogError::new(
            "MODEL_CONFIGURATION",
            "Selected report model changed; retry using current settings",
        ));
    }
    let client = ModelClient::new(endpoint.clone());
    let started = Instant::now();
    let mut renewed = Instant::now();
    let mut heartbeat = || {
        if stop.load(Ordering::Relaxed) || environment.endpoint().as_ref() != Some(&endpoint) {
            return Err(cancelled());
        }
        if started.elapsed() >= Duration::from_secs(30 * 60) {
            return Err(WorklogError::new(
                "RUN_TIMEOUT",
                "Report generation exceeded total time limit",
            ));
        }
        if renewed.elapsed() >= Duration::from_secs(30) {
            repository.renew_run(run, Utc::now())?;
            renewed = Instant::now();
        }
        Ok(())
    };
    let batches = reports::chunks(&run.sources)?;
    let batch_count = batches.len();
    let mut blocks = Vec::new();
    for batch in batches {
        let session = client.create_session()?;
        repository.set_run_session(run, &session)?;
        let prompt = reports::prompt(run, &batch.input)?;
        let raw = client.generate((&session, &prompt), &mut heartbeat);
        client.abort(&session);
        let raw = raw?;
        let output = reports::validate_output(&raw, batch.sources)?;
        reports::validate_format(&output, &run.kind)?;
        blocks.extend(output.blocks);
    }
    let mut output = reports::ReportOutput { blocks };
    if batch_count > 1 {
        output = super::runner_reports::merge(
            &super::runner_reports::GenerationContext {
                client: &client,
                repository,
                run,
            },
            output,
            &mut heartbeat,
        )?;
    }
    let output_text = serde_json::to_string(&output)?;
    if output_text.chars().count() > reports::OUTPUT_LIMIT {
        return Err(WorklogError::new(
            "REPORT_TOO_LARGE",
            "Report summaries exceed output limit; generate a shorter period",
        ));
    }
    reports::validate_output(&output_text, &run.sources)?;
    reports::validate_format(&output, &run.kind)?;
    heartbeat()?;
    let missing = missing_dates(run, cutoff_date)?;
    repository.publish_run(run, (&reports::render(&output, &missing), Utc::now()))?;
    Ok(())
}
fn missing_dates(run: &ClaimedRun, cutoff_date: NaiveDate) -> WorklogResult<Vec<String>> {
    let mut date = NaiveDate::parse_from_str(&run.period_start, "%Y-%m-%d")
        .map_err(|_| WorklogError::validation("Invalid period"))?;
    let end = NaiveDate::parse_from_str(&run.period_end, "%Y-%m-%d")
        .map_err(|_| WorklogError::validation("Invalid period"))?;
    let covered: BTreeSet<_> = run
        .sources
        .iter()
        .map(|source| source.business_date.as_str())
        .collect();
    let mut missing = Vec::new();
    while date <= end && date <= cutoff_date {
        if date.weekday().number_from_monday() <= 5 && !covered.contains(date.to_string().as_str())
        {
            missing.push(date.to_string());
        }
        date = date
            .checked_add_signed(ChronoDuration::days(1))
            .ok_or_else(|| WorklogError::validation("Invalid period"))?;
    }
    Ok(missing)
}
fn cancelled() -> WorklogError {
    WorklogError::new("RUN_CANCELLED", "Report execution was interrupted")
}

#[cfg(test)]
#[path = "runner_configuration_tests.rs"]
mod configuration_tests;
#[cfg(test)]
#[path = "runner_http_tests.rs"]
mod http_tests;
#[cfg(test)]
#[path = "runner_publication_tests.rs"]
mod publication_tests;
#[cfg(test)]
#[path = "runner_tests.rs"]
mod tests;
