use super::contract::{Operation, Phase, Preferences, Snapshot, Status, TimerError};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Progress {
    Idle,
    Running { deadline: Duration },
    Paused { remaining: Duration },
    Ready,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Timer {
    preferences: Preferences,
    phase: Phase,
    progress: Progress,
    duration: Duration,
    revision: u64,
}

impl Timer {
    pub fn new(preferences: Preferences) -> Self {
        Self {
            preferences,
            phase: Phase::Focus,
            progress: Progress::Idle,
            duration: preferences.duration(Phase::Focus),
            revision: 0,
        }
    }

    pub const fn revision(&self) -> u64 {
        self.revision
    }

    pub fn dispatch(
        &mut self,
        operation: Operation,
        now: Duration,
    ) -> Result<Snapshot, TimerError> {
        let preferences = match operation {
            Operation::Start(preferences)
            | Operation::SelectPhase(_, preferences)
            | Operation::Configure(preferences) => Some(preferences),
            Operation::Get | Operation::Pause | Operation::Reset => None,
        };
        // Work on a candidate so validation or deadline overflow cannot partly change state.
        let mut next = self.clone();
        if let Some(preferences) = preferences {
            next.configure(preferences);
        }
        let completed = next.expire(now);
        match operation {
            Operation::Get | Operation::Configure(_) => {}
            Operation::Start(_) => {
                if !completed {
                    next.start(now)?;
                }
            }
            Operation::Pause => match next.progress {
                Progress::Running { deadline } => {
                    next.progress = Progress::Paused {
                        remaining: deadline.saturating_sub(now),
                    };
                }
                Progress::Idle | Progress::Paused { .. } | Progress::Ready => {}
            },
            Operation::Reset => next.reset(next.phase),
            Operation::SelectPhase(phase, _) => next.reset(phase),
        }
        if next != *self {
            next.revision = self.revision.saturating_add(1);
            *self = next;
        }
        Ok(self.snapshot(now))
    }

    fn configure(&mut self, preferences: Preferences) {
        self.preferences = preferences;
        match self.progress {
            Progress::Idle | Progress::Ready => self.duration = preferences.duration(self.phase),
            Progress::Running { .. } | Progress::Paused { .. } => {}
        }
    }

    fn expire(&mut self, now: Duration) -> bool {
        match self.progress {
            Progress::Running { deadline } if now >= deadline => {
                self.phase = match self.phase {
                    Phase::Focus => Phase::Break,
                    Phase::Break => Phase::Focus,
                };
                self.duration = self.preferences.duration(self.phase);
                self.progress = Progress::Ready;
                true
            }
            Progress::Running { .. }
            | Progress::Idle
            | Progress::Paused { .. }
            | Progress::Ready => false,
        }
    }

    fn start(&mut self, now: Duration) -> Result<(), TimerError> {
        let remaining = match self.progress {
            Progress::Idle | Progress::Ready => self.duration,
            Progress::Paused { remaining } => remaining,
            Progress::Running { .. } => return Ok(()),
        };
        let deadline = now.checked_add(remaining).ok_or(TimerError::ClockRange)?;
        self.progress = Progress::Running { deadline };
        Ok(())
    }

    fn reset(&mut self, phase: Phase) {
        self.phase = phase;
        self.duration = self.preferences.duration(phase);
        self.progress = Progress::Idle;
    }

    fn snapshot(&self, now: Duration) -> Snapshot {
        let (status, remaining) = match self.progress {
            Progress::Idle => (Status::Idle, self.duration),
            Progress::Ready => (Status::Ready, self.duration),
            Progress::Running { deadline } => (
                Status::Running,
                deadline.saturating_sub(now).min(self.duration),
            ),
            Progress::Paused { remaining } => (Status::Paused, remaining),
        };
        Snapshot {
            phase: self.phase,
            status,
            remaining_ms: remaining.as_secs() * 1000 + u64::from(remaining.subsec_millis()),
            duration_ms: self.duration.as_secs() * 1000,
            preferences: self.preferences,
            revision: self.revision,
        }
    }
}
