use std::collections::HashMap;

use serde::Deserialize;
use url::Url;

use super::{ExternalVerification, VerificationProblem, VerificationTarget};
use crate::ccswitch::recovery::FileObservation;

#[derive(Deserialize)]
struct OpenCodeDocument {
    #[serde(default)]
    provider: HashMap<String, OpenCodeProvider>,
}

#[derive(Deserialize)]
struct OpenCodeProvider {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    options: ProviderOptions,
    #[serde(default)]
    models: HashMap<String, serde::de::IgnoredAny>,
}

#[derive(Default, Deserialize)]
struct ProviderOptions {
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
}

/// Mirrors cc-switch v3.20.1 `import_provider_from_deeplink`, which derives the
/// OpenCode provider key as `<sanitized-name>-<unix-millis>` and writes no `name`.
fn ccswitch_generated_id_prefix(provider_name: &str) -> String {
    provider_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>()
        .to_lowercase()
}

/// Returns the trailing millisecond stamp when `id` matches `<prefix>-<digits>`.
fn generated_id_generation(id: &str, prefix: &str) -> Option<u64> {
    let rest = id.strip_prefix(prefix)?.strip_prefix('-')?;
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse::<u64>().ok()
}

pub(crate) fn classify_changed_config(
    observation: FileObservation,
    bytes: Option<&[u8]>,
    target: &VerificationTarget,
) -> ExternalVerification {
    let current_hash = observation.hash().map(str::to_owned);
    let Some(bytes) = bytes else {
        return changed_invalid(VerificationProblem::ProviderMissing, current_hash);
    };
    let document: OpenCodeDocument = match serde_json::from_slice(bytes) {
        Ok(document) => document,
        Err(_) => return changed_invalid(VerificationProblem::MalformedConfig, current_hash),
    };
    classify_document(document, current_hash, target)
}

fn classify_document(
    document: OpenCodeDocument,
    current_hash: Option<String>,
    target: &VerificationTarget,
) -> ExternalVerification {
    let expected_endpoint = normalize_endpoint(&target.endpoint);
    let generated_prefix = ccswitch_generated_id_prefix(&target.provider_name);
    let mut matching_endpoint = false;
    let mut matching_provider = false;
    let mut candidates = Vec::new();
    for (provider_id, provider) in document.provider {
        let endpoint_matches = provider
            .options
            .base_url
            .as_deref()
            .and_then(normalize_endpoint)
            .zip(expected_endpoint.as_ref())
            .is_some_and(|(actual, expected)| actual == *expected);
        if !endpoint_matches {
            continue;
        }
        matching_endpoint = true;
        let generation = generated_id_generation(&provider_id, &generated_prefix);
        let identity_matches = provider.name.as_deref() == Some(target.provider_name.as_str())
            || provider_id == target.provider_name
            || generation.is_some();
        if !identity_matches {
            continue;
        }
        matching_provider = true;
        if provider.models.contains_key(&target.model_id) {
            let observed_name = provider.name.as_deref().unwrap_or(provider_id.as_str());
            candidates.push((generation.unwrap_or(0), observed_name.to_owned()));
        }
    }
    candidates.sort_unstable_by(|left, right| right.0.cmp(&left.0));
    if let Some((_, provider_name)) = candidates.into_iter().next() {
        let Some(current_hash) = current_hash else {
            return changed_invalid(VerificationProblem::ProviderMissing, None);
        };
        return ExternalVerification::Verified {
            provider_name,
            model_id: target.model_id.clone(),
            current_hash,
        };
    }
    changed_invalid(
        if matching_endpoint && matching_provider {
            VerificationProblem::ModelMissing
        } else {
            VerificationProblem::ProviderMissing
        },
        current_hash,
    )
}

fn changed_invalid(
    reason: VerificationProblem,
    current_hash: Option<String>,
) -> ExternalVerification {
    ExternalVerification::ChangedInvalid {
        reason,
        current_hash,
    }
}

fn normalize_endpoint(value: &str) -> Option<String> {
    let mut parsed = match Url::parse(value.trim()) {
        Ok(parsed) => parsed,
        Err(_) => return None,
    };
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return None;
    }
    let trimmed = parsed.path().trim_end_matches('/').to_owned();
    parsed.set_path(&trimmed);
    Some(parsed.to_string().trim_end_matches('/').to_owned())
}
