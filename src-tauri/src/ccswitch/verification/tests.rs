mod auth;

use std::time::Duration;

use super::*;
use crate::ccswitch::recovery::{FileObservation, ObservedFiles};

fn missing_baseline() -> ObservedFiles {
    ObservedFiles {
        config: FileObservation::Missing,
        auth: FileObservation::Missing,
    }
}

fn present_baseline(config_hash: &str, auth_hash: &str) -> ObservedFiles {
    ObservedFiles {
        config: FileObservation::Present {
            sha256: config_hash.to_owned(),
        },
        auth: FileObservation::Present {
            sha256: auth_hash.to_owned(),
        },
    }
}

fn target(initial: ObservedFiles) -> VerificationTarget {
    VerificationTarget {
        provider_name: "Test Provider".to_owned(),
        endpoint: "https://api.example.test/v1/".to_owned(),
        model_id: "model-a".to_owned(),
        initial,
    }
}

#[test]
fn changed_config_is_verified_when_provider_identity_endpoint_and_model_match() {
    let current_hash = "b".repeat(64);
    let config = r#"{
  "provider": {
    "generated-provider-id": {
      "name": "Test Provider",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"display": "Model A"}}
    }
  }
}"#
    .to_owned();

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::Verified {
            provider_name: "Test Provider".to_owned(),
            model_id: "model-a".to_owned(),
            current_hash,
        }
    );
}

#[test]
fn ccswitch_generated_provider_id_without_name_field_is_verified() {
    let current_hash = "c".repeat(64);
    let config = r#"{
  "provider": {
    "kuro": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"name": "model-a"}}
    },
    "testprovider-1788437547133": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"name": "model-a"}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::Verified {
            provider_name: "testprovider-1788437547133".to_owned(),
            model_id: "model-a".to_owned(),
            current_hash,
        }
    );
}

#[test]
fn unrelated_provider_sharing_endpoint_and_model_is_not_accepted() {
    let current_hash = "d".repeat(64);
    let config = r#"{
  "provider": {
    "kuro": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"name": "model-a"}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::ChangedInvalid {
            reason: VerificationProblem::ProviderMissing,
            current_hash: Some(current_hash),
        }
    );
}

#[test]
fn newest_generated_provider_wins_when_multiple_generations_exist() {
    let current_hash = "e".repeat(64);
    let config = r#"{
  "provider": {
    "testprovider-1788437547133": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"other-model": {"name": "other-model"}}
    },
    "testprovider-1788437599999": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"name": "model-a"}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::Verified {
            provider_name: "testprovider-1788437599999".to_owned(),
            model_id: "model-a".to_owned(),
            current_hash,
        }
    );
}

#[test]
fn explicit_name_field_still_matches_for_forward_compatibility() {
    let current_hash = "f".repeat(64);
    let config = r#"{
  "provider": {
    "arbitrary-provider-id": {
      "name": "Test Provider",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"name": "model-a"}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::Verified {
            provider_name: "Test Provider".to_owned(),
            model_id: "model-a".to_owned(),
            current_hash,
        }
    );
}

#[test]
fn same_endpoint_and_model_under_different_provider_identity_is_changed_invalid() {
    let current_hash = "c".repeat(64);
    let config = r#"{
  "provider": {
    "Different Provider": {
      "name": "Different Provider",
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"model-a": {"display": "Model A"}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::ChangedInvalid {
            reason: VerificationProblem::ProviderMissing,
            current_hash: Some(current_hash),
        }
    );
}

#[test]
fn matching_provider_id_without_name_reports_observed_provider_identity() {
    let current_hash = "d".repeat(64);
    let config = r#"{
  "provider": {
    "Test Provider": {
      "options": {"baseURL": "https://api.example.test/v1/"},
      "models": {"model-a": {}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::Verified {
            provider_name: "Test Provider".to_owned(),
            model_id: "model-a".to_owned(),
            current_hash,
        }
    );
}

#[test]
fn changed_config_with_missing_model_is_invalid() {
    let current_hash = "e".repeat(64);
    let config = r#"{
  "provider": {
    "Test Provider": {
      "options": {"baseURL": "https://api.example.test/v1"},
      "models": {"other-model": {}}
    }
  }
}"#;

    let status = classify_changed_config(
        FileObservation::Present {
            sha256: current_hash.clone(),
        },
        Some(config.as_bytes()),
        &target(missing_baseline()),
    );

    assert_eq!(
        status,
        ExternalVerification::ChangedInvalid {
            reason: VerificationProblem::ModelMissing,
            current_hash: Some(current_hash),
        }
    );
}

#[test]
fn malformed_changed_config_is_invalid_without_exposing_bytes() {
    let canary = format!("yume-redacted-{}", uuid::Uuid::new_v4());
    let status = classify_changed_config(
        FileObservation::Present {
            sha256: "f".repeat(64),
        },
        Some(format!(r#"{{"token":"{canary}""#).as_bytes()),
        &target(missing_baseline()),
    );

    assert!(matches!(
        status,
        ExternalVerification::ChangedInvalid {
            reason: VerificationProblem::MalformedConfig,
            ..
        }
    ));
    assert!(!format!("{status:?}").contains(&canary));
}

#[test]
fn unchanged_config_remains_pending() {
    let initial = present_baseline(&"1".repeat(64), &"2".repeat(64));
    let status = ExternalVerification::Pending {
        current_hash: initial.config.hash().map(str::to_owned),
    };

    assert_eq!(
        status.current_observation(),
        Some(FileObservation::Present {
            sha256: "1".repeat(64),
        })
    );
}

#[derive(Clone, Copy)]
struct FakeClock {
    elapsed: Duration,
    waits: usize,
}

impl FakeClock {
    fn new() -> Self {
        Self {
            elapsed: Duration::ZERO,
            waits: 0,
        }
    }
}

impl PollClock for FakeClock {
    fn elapsed(&self) -> Duration {
        self.elapsed
    }

    fn wait(&mut self, duration: Duration) {
        self.elapsed += duration;
        self.waits += 1;
    }
}

#[test]
fn poll_returns_terminal_verification_without_extra_wait() {
    let mut clock = FakeClock::new();
    let mut calls = 0usize;
    let mut probe = || {
        calls += 1;
        ExternalVerification::Verified {
            provider_name: "Observed Provider".to_owned(),
            model_id: "model-a".to_owned(),
            current_hash: "a".repeat(64),
        }
    };

    let status = poll_with(
        &mut probe,
        &mut clock,
        PollPolicy::new(Duration::from_secs(2), Duration::from_millis(250))
            .expect("valid poll policy"),
    );

    assert!(matches!(status, ExternalVerification::Verified { .. }));
    assert_eq!(calls, 1);
    assert_eq!(clock.waits, 0);
}

#[test]
fn poll_times_out_with_last_stable_fingerprint() {
    let mut clock = FakeClock::new();
    let mut probe = || ExternalVerification::Pending {
        current_hash: Some("9".repeat(64)),
    };

    let status = poll_with(
        &mut probe,
        &mut clock,
        PollPolicy::new(Duration::from_secs(1), Duration::from_millis(400))
            .expect("valid poll policy"),
    );

    assert_eq!(
        status,
        ExternalVerification::Timeout {
            changed: false,
            current_hash: Some("9".repeat(64)),
        }
    );
    assert_eq!(clock.elapsed(), Duration::from_secs(1));
}

#[test]
fn invalid_poll_policy_is_rejected() {
    assert!(matches!(
        PollPolicy::new(Duration::ZERO, Duration::from_millis(1)),
        Err(VerificationError::InvalidPolicy)
    ));
    assert!(matches!(
        PollPolicy::new(Duration::from_millis(1), Duration::ZERO),
        Err(VerificationError::InvalidPolicy)
    ));
    assert!(matches!(
        PollPolicy::new(Duration::from_millis(1), Duration::from_millis(2)),
        Err(VerificationError::InvalidPolicy)
    ));
}
