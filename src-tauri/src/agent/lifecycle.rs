use super::record_store::{NativeMessage, RunOutcome, RunRecord, RunStore};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::{Mutex, MutexGuard},
};

pub(super) struct RunData {
    pub(super) active: Option<RunRecord>,
    pub(super) recent: Vec<RunRecord>,
    pub(super) artifacts: Vec<super::artifacts::AgentArtifact>,
}

pub(crate) struct AgentRunState {
    pub(super) data: Mutex<RunData>,
    pub(super) store: RunStore,
    operation: Mutex<()>,
}

impl AgentRunState {
    #[cfg(test)]
    pub(crate) fn new(store: RunStore) -> Self {
        Self {
            data: Mutex::new(RunData {
                active: None,
                recent: Vec::new(),
                artifacts: Vec::new(),
            }),
            store,
            operation: Mutex::new(()),
        }
    }

    pub(crate) fn load(store: RunStore) -> Result<Self, String> {
        let records = store.load()?;
        let active = records
            .iter()
            .find(|record| record.outcome.is_none())
            .cloned();
        let recent = records
            .into_iter()
            .filter(|record| record.outcome.is_some())
            .collect();
        Ok(Self {
            data: Mutex::new(RunData {
                active,
                recent,
                artifacts: Vec::new(),
            }),
            store,
            operation: Mutex::new(()),
        })
    }

    pub(crate) fn lock_operation(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.operation
            .lock()
            .map_err(|_| "agent_state_unavailable".to_owned())
    }

    pub(crate) fn begin(&self, run_id: &str, workspace: &Path, input: &str) -> Result<(), String> {
        if !crate::worklog::bridge::safe_id(run_id) || input.trim().is_empty() {
            return Err("agent_start_invalid".into());
        }
        let workspace_path = workspace
            .canonicalize()
            .map_err(|_| "workspace_invalid_path")?;
        if !workspace_path.is_dir() {
            return Err("workspace_not_directory".into());
        }
        let mut data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        if data.active.is_some() {
            return Err("agent_run_busy".into());
        }
        let record = RunRecord {
            run_id: run_id.into(),
            session_id: None,
            workspace_path,
            created_at: chrono::Utc::now().to_rfc3339(),
            ended_at: None,
            outcome: None,
            error_summary: None,
            pending_outcome: None,
            pending_error_summary: None,
            message_ids: Vec::new(),
            part_ids: Vec::new(),
            call_ids: Vec::new(),
            initial_input: Some(input.into()),
        };
        self.store.write(&record)?;
        data.active = Some(record);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn bind_session(&self, run_id: &str, session_id: &str) -> Result<(), String> {
        self.bind_session_with(run_id, session_id, || Ok(()))
    }

    pub(crate) fn bind_session_with(
        &self,
        run_id: &str,
        session_id: &str,
        register: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        let record = data
            .active
            .as_mut()
            .filter(|record| record.run_id == run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        register()?;
        record.session_id = Some(session_id.into());
        self.store.write(record)
    }

    pub(crate) fn confirm_submission(&self, run_id: &str) -> Result<(), String> {
        self.update_active(run_id, |record| record.initial_input = None)
    }

    #[cfg(test)]
    pub(crate) fn cancel_with(
        &self,
        run_id: &str,
        abort: impl FnOnce(&str) -> Result<bool, String>,
    ) -> Result<(), String> {
        let session = self.active_session(run_id)?;
        if !abort(&session)? {
            self.update_active(run_id, |record| {
                record.error_summary = Some("abort_not_confirmed".into())
            })?;
            return Err("agent_abort_unconfirmed".into());
        }
        self.finish(run_id, RunOutcome::Cancelled, None)
    }

    pub(crate) fn reconcile(&self, run_id: &str, messages: &[NativeMessage]) -> Result<(), String> {
        let mut terminal: Option<(RunOutcome, Option<String>)> = None;
        self.update_active(run_id, |record| {
            let mut message_ids: BTreeSet<String> = record.message_ids.iter().cloned().collect();
            let mut part_ids: BTreeSet<String> = record.part_ids.iter().cloned().collect();
            let mut call_ids: BTreeSet<String> = record.call_ids.iter().cloned().collect();
            let mut latest = None;
            for message in messages
                .iter()
                .filter(|message| message.parent_id.as_deref() == Some(run_id))
            {
                latest = Some(message);
                message_ids.insert(message.id.clone());
                for part in &message.parts {
                    part_ids.insert(part.id.clone());
                    if let Some(call_id) = &part.call_id {
                        call_ids.insert(call_id.clone());
                    }
                }
            }
            if let Some(message) = latest {
                let has_in_flight_tool = message.parts.iter().any(|part| {
                    matches!(
                        part.state.as_ref().map(|state| state.status.as_str()),
                        Some("pending" | "running")
                    )
                });
                terminal = if let Some(error) = &message.error {
                    Some((RunOutcome::Failed, Some(error.clone())))
                } else if message.completed
                    && message.finish.as_deref() == Some("stop")
                    && !has_in_flight_tool
                {
                    Some((RunOutcome::Completed, None))
                } else {
                    None
                };
            }
            record.message_ids = message_ids.into_iter().collect();
            record.part_ids = part_ids.into_iter().collect();
            record.call_ids = call_ids.into_iter().collect();
        })?;
        let mut data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        if let Some(record) = data
            .active
            .as_ref()
            .filter(|record| record.run_id == run_id)
        {
            data.artifacts = super::artifacts::collect(record, messages);
        }
        drop(data);
        if let Some((outcome, error)) = terminal {
            self.finish(run_id, outcome, error)?;
        }
        Ok(())
    }

    pub(crate) fn interrupt_active(&self, summary: &str) -> Result<(), String> {
        let run_id = self
            .data
            .lock()
            .map_err(|_| "agent_state_unavailable")?
            .active
            .as_ref()
            .map(|record| record.run_id.clone());
        if let Some(run_id) = run_id {
            self.finish(&run_id, RunOutcome::Interrupted, Some(summary.into()))?;
        }
        Ok(())
    }

    pub(crate) fn request_finish(
        &self,
        run_id: &str,
        outcome: RunOutcome,
        error: Option<String>,
    ) -> Result<(), String> {
        self.update_active(run_id, |record| {
            record.pending_outcome = Some(outcome);
            record.pending_error_summary = error;
        })
    }

    pub(super) fn set_collection_error(
        &self,
        run_id: &str,
        error: Option<&str>,
    ) -> Result<(), String> {
        let next = error.map(str::to_owned);
        if self.active_record(run_id)?.error_summary == next {
            return Ok(());
        }
        self.update_active(run_id, |record| record.error_summary = next)
    }

    fn update_active(
        &self,
        run_id: &str,
        update: impl FnOnce(&mut RunRecord),
    ) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        let record = data
            .active
            .as_mut()
            .filter(|record| record.run_id == run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        update(record);
        self.store.write(record)
    }
}
