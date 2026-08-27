use std::thread;
use std::time::{Duration, Instant};

use super::ExternalVerification;

const MAX_POLL_DURATION: Duration = Duration::from_secs(120);
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationError {
    InvalidPolicy,
}

#[derive(Clone, Copy)]
pub struct PollPolicy {
    timeout: Duration,
    interval: Duration,
}

impl PollPolicy {
    pub fn new(timeout: Duration, interval: Duration) -> Result<Self, VerificationError> {
        if timeout.is_zero()
            || timeout > MAX_POLL_DURATION
            || interval.is_zero()
            || interval > timeout
        {
            return Err(VerificationError::InvalidPolicy);
        }
        Ok(Self { timeout, interval })
    }

    pub(crate) fn production() -> Self {
        Self {
            timeout: MAX_POLL_DURATION,
            interval: DEFAULT_POLL_INTERVAL,
        }
    }
}

pub trait PollClock {
    fn elapsed(&self) -> Duration;
    fn wait(&mut self, duration: Duration);
}

pub(crate) struct SystemPollClock {
    started: Instant,
}

impl SystemPollClock {
    pub(crate) fn start() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl PollClock for SystemPollClock {
    fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }

    fn wait(&mut self, duration: Duration) {
        thread::sleep(duration);
    }
}

pub(crate) fn poll_with(
    probe: &mut impl FnMut() -> ExternalVerification,
    clock: &mut impl PollClock,
    policy: PollPolicy,
) -> ExternalVerification {
    loop {
        let last_hash = match probe() {
            ExternalVerification::Pending { current_hash } => current_hash,
            terminal => return terminal,
        };
        let elapsed = clock.elapsed();
        if elapsed >= policy.timeout {
            return ExternalVerification::Timeout {
                changed: false,
                current_hash: last_hash,
            };
        }
        clock.wait(policy.interval.min(policy.timeout.saturating_sub(elapsed)));
    }
}
