use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RawPreferences")]
pub struct Preferences {
    focus_minutes: u16,
    break_minutes: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPreferences {
    focus_minutes: u16,
    break_minutes: u16,
}

impl TryFrom<RawPreferences> for Preferences {
    type Error = TimerError;

    fn try_from(raw: RawPreferences) -> Result<Self, Self::Error> {
        if !(1..=180).contains(&raw.focus_minutes) || !(1..=60).contains(&raw.break_minutes) {
            return Err(TimerError::InvalidPreferences);
        }
        Ok(Self {
            focus_minutes: raw.focus_minutes,
            break_minutes: raw.break_minutes,
        })
    }
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            break_minutes: 5,
        }
    }
}

impl Preferences {
    pub fn duration(self, phase: Phase) -> Duration {
        let minutes = match phase {
            Phase::Focus => self.focus_minutes,
            Phase::Break => self.break_minutes,
        };
        Duration::from_secs(u64::from(minutes) * 60)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Focus,
    Break,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Idle,
    Running,
    Paused,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: Phase,
    pub status: Status,
    pub remaining_ms: u64,
    pub duration_ms: u64,
    pub preferences: Preferences,
    pub revision: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum Operation {
    Get,
    Start(Preferences),
    Pause,
    Reset,
    SelectPhase(Phase, Preferences),
    Configure(Preferences),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerError {
    InvalidPreferences,
    ClockRange,
    StateUnavailable,
}

impl std::fmt::Display for TimerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidPreferences => "invalid_pomodoro_preferences",
            Self::ClockRange => "pomodoro_clock_out_of_range",
            Self::StateUnavailable => "pomodoro_state_unavailable",
        })
    }
}

impl std::error::Error for TimerError {}

pub fn deserialize_stored_preferences<'de, D>(deserializer: D) -> Result<Preferences, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value::<Preferences>(value).unwrap_or_default())
}
