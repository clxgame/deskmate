use super::{lifecycle::AgentRunState, record_store::RunOutcome};

struct RunFinish {
    outcome: RunOutcome,
    error: Option<String>,
    clear_input: bool,
}

impl AgentRunState {
    pub(crate) fn fail_active(&self, run_id: &str, summary: &str) -> Result<(), String> {
        self.finish(run_id, RunOutcome::Failed, Some(summary.into()))
    }

    pub(crate) fn fail_active_preserving_input(
        &self,
        run_id: &str,
        summary: &str,
    ) -> Result<(), String> {
        self.finish_with(
            run_id,
            RunFinish {
                outcome: RunOutcome::Failed,
                error: Some(summary.into()),
                clear_input: false,
            },
        )
    }

    pub(crate) fn cancel_preparation(&self, run_id: &str) -> Result<(), String> {
        if self.active_record(run_id)?.initial_input.is_none() {
            return Err("agent_run_confirmed".to_owned());
        }
        self.finish(run_id, RunOutcome::Cancelled, None)
    }

    pub(super) fn finish(
        &self,
        run_id: &str,
        outcome: RunOutcome,
        error: Option<String>,
    ) -> Result<(), String> {
        self.finish_with(
            run_id,
            RunFinish {
                outcome,
                error,
                clear_input: true,
            },
        )
    }

    fn finish_with(&self, run_id: &str, finish: RunFinish) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        if !data
            .active
            .as_ref()
            .is_some_and(|record| record.run_id == run_id)
        {
            return Err("agent_run_unknown".to_owned());
        }
        let mut record = data
            .active
            .take()
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        if finish.clear_input {
            record.initial_input = None;
        }
        record.outcome = Some(finish.outcome);
        record.error_summary = finish.error;
        record.pending_outcome = None;
        record.pending_error_summary = None;
        record.ended_at = Some(chrono::Utc::now().to_rfc3339());
        if let Err(error) = self.store.write(&record) {
            data.active = Some(record);
            return Err(error);
        }
        data.recent.insert(0, record);
        Ok(())
    }
}
