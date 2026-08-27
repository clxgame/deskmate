// allow: SIZE_OK — Todo 1 keeps the versioned boundary contract and invariant tests together until platform/protocol/recovery split it.
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use url::{Host, Url};
use uuid::Uuid;

pub const CONTRACT_VERSION: u8 = 1;
const TICKET_TTL_MS: u64 = 10 * 60 * 1_000;
const MAX_PROVIDER_NAME_LEN: usize = 80;
const MAX_ENDPOINT_LEN: usize = 2_048;
const MAX_MODEL_ID_LEN: usize = 256;
const MAX_MODEL_NAME_LEN: usize = 160;
const MAX_API_KEY_LEN: usize = 8_192;
const MAX_HASH_LEN: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MillisSinceEpoch(pub u64);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchCapability {
    pub contract_version: u8,
    pub status: CcSwitchCapabilityStatus,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CcSwitchCapabilityStatus {
    Available { version: String },
    MissingProtocol,
    UnsupportedPlatform,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretFreeProviderDraft {
    pub contract_version: u8,
    pub provider_name: String,
    pub endpoint: Option<String>,
    pub model_hint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetupInput {
    pub provider_name: String,
    pub endpoint: String,
    pub api_key: String,
    pub selected_model: String,
    pub models: Vec<ModelChoice>,
    pub pre_import_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderValidationResult {
    pub contract_version: u8,
    pub receipt: HandoffReceipt,
    pub models: Vec<ModelChoice>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffReceipt {
    pub contract_version: u8,
    pub ticket_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub selected_model: String,
    pub pre_import_hash: String,
    pub expires_at: MillisSinceEpoch,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VerificationState {
    Pending,
    Verified {
        provider_name: String,
        model_id: String,
    },
    ChangedInvalid {
        reason: String,
    },
    Timeout,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CcSwitchConflict {
    ExternalConfigChanged { current_hash: String },
    ProviderMissing,
    ModelMissing { model_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RecoveryState {
    Unneeded,
    Available { snapshot_id: String },
    Restored { restored_hash: String },
    Stale { current_hash: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CcSwitchContractError {
    InvalidProviderName,
    InvalidEndpoint,
    InvalidApiKey,
    InvalidModelCatalog,
    InvalidModel,
    InvalidHash,
    TicketMissing,
    TicketExpired,
    TicketStale,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketConsumeRequest {
    pub ticket_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub selected_model: String,
    pub pre_import_hash: String,
}

pub struct PreparedHandoff {
    ticket: StoredTicket,
}

impl PreparedHandoff {
    pub fn api_key(&self) -> &str {
        &self.ticket.api_key
    }

    pub fn receipt(&self) -> HandoffReceipt {
        self.ticket.receipt()
    }
}

#[derive(Default)]
pub struct CcSwitchSetupState {
    tickets: Mutex<HashMap<String, StoredTicket>>,
}

impl CcSwitchSetupState {
    pub fn stage_provider(
        &self,
        input: ProviderSetupInput,
        now: MillisSinceEpoch,
    ) -> Result<ProviderValidationResult, CcSwitchContractError> {
        let provider_name = normalize_bounded(
            &input.provider_name,
            MAX_PROVIDER_NAME_LEN,
            CcSwitchContractError::InvalidProviderName,
        )?;
        let endpoint = normalize_endpoint(&input.endpoint)?;
        let api_key = normalize_bounded(
            &input.api_key,
            MAX_API_KEY_LEN,
            CcSwitchContractError::InvalidApiKey,
        )?;
        let pre_import_hash = normalize_bounded(
            &input.pre_import_hash,
            MAX_HASH_LEN,
            CcSwitchContractError::InvalidHash,
        )?;
        let models = normalize_models(input.models)?;
        let selected_model = normalize_bounded(
            &input.selected_model,
            MAX_MODEL_ID_LEN,
            CcSwitchContractError::InvalidModel,
        )?;
        if !models.iter().any(|model| model.id == selected_model) {
            return Err(CcSwitchContractError::InvalidModel);
        }

        let ticket_id = Uuid::new_v4().to_string();
        let ticket = StoredTicket {
            ticket_id: ticket_id.clone(),
            provider_name,
            endpoint,
            api_key,
            selected_model,
            models: models.clone(),
            pre_import_hash,
            expires_at: MillisSinceEpoch(now.0.saturating_add(TICKET_TTL_MS)),
        };
        let receipt = ticket.receipt();
        self.tickets
            .lock()
            .map_err(|_| CcSwitchContractError::TicketMissing)?
            .insert(ticket_id, ticket);
        Ok(ProviderValidationResult {
            contract_version: CONTRACT_VERSION,
            receipt,
            models,
        })
    }

    pub fn consume_ticket(
        &self,
        request: TicketConsumeRequest,
        now: MillisSinceEpoch,
    ) -> Result<PreparedHandoff, CcSwitchContractError> {
        let endpoint = normalize_endpoint(&request.endpoint)?;
        let mut tickets = self
            .tickets
            .lock()
            .map_err(|_| CcSwitchContractError::TicketMissing)?;
        let ticket = tickets
            .get(&request.ticket_id)
            .ok_or(CcSwitchContractError::TicketMissing)?;
        ticket.ensure_fresh(now)?;
        ticket.ensure_matches(&request.provider_name, &endpoint, &request)?;
        let ticket = tickets
            .remove(&request.ticket_id)
            .ok_or(CcSwitchContractError::TicketMissing)?;
        Ok(PreparedHandoff { ticket })
    }
}

struct StoredTicket {
    ticket_id: String,
    provider_name: String,
    endpoint: String,
    api_key: String,
    selected_model: String,
    models: Vec<ModelChoice>,
    pre_import_hash: String,
    expires_at: MillisSinceEpoch,
}

impl StoredTicket {
    fn receipt(&self) -> HandoffReceipt {
        HandoffReceipt {
            contract_version: CONTRACT_VERSION,
            ticket_id: self.ticket_id.clone(),
            provider_name: self.provider_name.clone(),
            endpoint: self.endpoint.clone(),
            selected_model: self.selected_model.clone(),
            pre_import_hash: self.pre_import_hash.clone(),
            expires_at: self.expires_at,
        }
    }

    fn ensure_fresh(&self, now: MillisSinceEpoch) -> Result<(), CcSwitchContractError> {
        if now >= self.expires_at {
            return Err(CcSwitchContractError::TicketExpired);
        }
        Ok(())
    }

    fn ensure_matches(
        &self,
        provider_name: &str,
        endpoint: &str,
        request: &TicketConsumeRequest,
    ) -> Result<(), CcSwitchContractError> {
        if self.provider_name != provider_name
            || self.endpoint != endpoint
            || self.pre_import_hash != request.pre_import_hash
        {
            return Err(CcSwitchContractError::TicketStale);
        }
        if self.selected_model != request.selected_model
            || !self
                .models
                .iter()
                .any(|model| model.id == request.selected_model)
        {
            return Err(CcSwitchContractError::InvalidModel);
        }
        Ok(())
    }
}

fn normalize_models(models: Vec<ModelChoice>) -> Result<Vec<ModelChoice>, CcSwitchContractError> {
    if models.is_empty() {
        return Err(CcSwitchContractError::InvalidModelCatalog);
    }
    models
        .into_iter()
        .map(|model| {
            Ok(ModelChoice {
                id: normalize_bounded(
                    &model.id,
                    MAX_MODEL_ID_LEN,
                    CcSwitchContractError::InvalidModelCatalog,
                )?,
                name: normalize_bounded(
                    &model.name,
                    MAX_MODEL_NAME_LEN,
                    CcSwitchContractError::InvalidModelCatalog,
                )?,
            })
        })
        .collect()
}

fn normalize_bounded(
    value: &str,
    max_len: usize,
    error: CcSwitchContractError,
) -> Result<String, CcSwitchContractError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > max_len || trimmed.chars().any(char::is_control) {
        return Err(error);
    }
    Ok(trimmed.to_owned())
}

fn normalize_endpoint(endpoint: &str) -> Result<String, CcSwitchContractError> {
    let trimmed = normalize_bounded(
        endpoint,
        MAX_ENDPOINT_LEN,
        CcSwitchContractError::InvalidEndpoint,
    )?;
    let mut url = Url::parse(&trimmed).map_err(|_| CcSwitchContractError::InvalidEndpoint)?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(CcSwitchContractError::InvalidEndpoint);
    }
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(url.host()) => {}
        _ => return Err(CcSwitchContractError::InvalidEndpoint),
    }
    if url.path() == "/" {
        url.set_path("");
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn is_loopback(host: Option<Host<&str>>) -> bool {
    match host {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(addr)) => addr.is_loopback(),
        Some(Host::Ipv6(addr)) => IpAddr::from(addr).is_loopback(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input(canary: &str) -> ProviderSetupInput {
        ProviderSetupInput {
            provider_name: " Test Provider ".into(),
            endpoint: "https://api.example.test/".into(),
            api_key: canary.into(),
            selected_model: "model-a".into(),
            models: vec![ModelChoice {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
            pre_import_hash: "hash-before".into(),
        }
    }

    fn stage(state: &CcSwitchSetupState, canary: &str) -> ProviderValidationResult {
        state
            .stage_provider(valid_input(canary), MillisSinceEpoch(1_000))
            .expect("valid provider stages")
    }

    #[test]
    fn creates_secret_free_ticket_for_valid_https_provider() {
        let state = CcSwitchSetupState::default();
        let canary = format!("sk-canary-{}", uuid::Uuid::new_v4());

        let result = stage(&state, &canary);

        let serialized = serde_json::to_string(&result).expect("validation result serializes");
        assert!(!serialized.contains(&canary));
        assert_eq!(result.receipt.endpoint, "https://api.example.test");
        assert_eq!(result.receipt.provider_name, "Test Provider");
    }

    #[test]
    fn accepts_loopback_http_and_rejects_unsafe_endpoint_forms() {
        let state = CcSwitchSetupState::default();
        let mut input = valid_input("sk-loopback");
        input.endpoint = "http://127.0.0.1:47892/v1-compatible/".into();
        let result = state
            .stage_provider(input, MillisSinceEpoch(1_000))
            .expect("loopback http is allowed");
        assert_eq!(
            result.receipt.endpoint,
            "http://127.0.0.1:47892/v1-compatible"
        );

        for endpoint in [
            "ftp://api.example.test",
            "http://api.example.test",
            "https://user:pass@api.example.test",
            "https://api.example.test/#token",
        ] {
            let mut input = valid_input("sk-bad-endpoint");
            input.endpoint = endpoint.into();
            assert_eq!(
                state.stage_provider(input, MillisSinceEpoch(1_000)),
                Err(CcSwitchContractError::InvalidEndpoint),
                "{endpoint} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_blank_control_and_overlong_fields() {
        let state = CcSwitchSetupState::default();
        let mut input = valid_input("sk-valid");
        input.provider_name = " ".into();
        assert_eq!(
            state.stage_provider(input, MillisSinceEpoch(1_000)),
            Err(CcSwitchContractError::InvalidProviderName)
        );

        let mut input = valid_input("sk-valid");
        input.api_key = "sk-\ninvalid".into();
        assert_eq!(
            state.stage_provider(input, MillisSinceEpoch(1_000)),
            Err(CcSwitchContractError::InvalidApiKey)
        );

        let mut input = valid_input("sk-valid");
        input.selected_model = "x".repeat(MAX_MODEL_ID_LEN + 1);
        assert_eq!(
            state.stage_provider(input, MillisSinceEpoch(1_000)),
            Err(CcSwitchContractError::InvalidModel)
        );
    }

    #[test]
    fn consumes_ticket_once_and_exposes_secret_only_after_binding_checks() {
        let state = CcSwitchSetupState::default();
        let canary = format!("sk-canary-{}", uuid::Uuid::new_v4());
        let result = stage(&state, &canary);
        let request = TicketConsumeRequest {
            ticket_id: result.receipt.ticket_id.clone(),
            provider_name: "Test Provider".into(),
            endpoint: "https://api.example.test".into(),
            selected_model: "model-a".into(),
            pre_import_hash: "hash-before".into(),
        };

        let handoff = state
            .consume_ticket(request, MillisSinceEpoch(2_000))
            .expect("fresh matching ticket consumes");
        assert_eq!(handoff.api_key(), canary);
        let serialized = serde_json::to_string(&handoff.receipt()).expect("receipt serializes");
        assert!(!serialized.contains(&canary));

        let replay = TicketConsumeRequest {
            ticket_id: result.receipt.ticket_id,
            provider_name: "Test Provider".into(),
            endpoint: "https://api.example.test".into(),
            selected_model: "model-a".into(),
            pre_import_hash: "hash-before".into(),
        };
        assert_eq!(
            state.consume_ticket(replay, MillisSinceEpoch(3_000)).err(),
            Some(CcSwitchContractError::TicketMissing)
        );
    }

    #[test]
    fn fails_closed_for_expired_wrong_model_and_stale_tickets() {
        let state = CcSwitchSetupState::default();
        let result = stage(&state, "sk-secret");
        let base = |model: &str, hash: &str| TicketConsumeRequest {
            ticket_id: result.receipt.ticket_id.clone(),
            provider_name: "Test Provider".into(),
            endpoint: "https://api.example.test".into(),
            selected_model: model.into(),
            pre_import_hash: hash.into(),
        };

        assert_eq!(
            state
                .consume_ticket(base("model-b", "hash-before"), MillisSinceEpoch(2_000))
                .err(),
            Some(CcSwitchContractError::InvalidModel)
        );
        assert_eq!(
            state
                .consume_ticket(base("model-a", "hash-after"), MillisSinceEpoch(2_000))
                .err(),
            Some(CcSwitchContractError::TicketStale)
        );
        assert_eq!(
            state
                .consume_ticket(base("model-a", "hash-before"), MillisSinceEpoch(601_000))
                .err(),
            Some(CcSwitchContractError::TicketExpired)
        );
    }

    #[test]
    fn frontend_facing_types_do_not_serialize_api_keys() {
        let canary = format!("sk-canary-{}", uuid::Uuid::new_v4());
        let state = CcSwitchSetupState::default();
        let result = stage(&state, &canary);
        let values = vec![
            serde_json::to_value(CcSwitchCapability {
                contract_version: CONTRACT_VERSION,
                status: CcSwitchCapabilityStatus::Available {
                    version: "3.20.0".into(),
                },
            })
            .expect("capability serializes"),
            serde_json::to_value(SecretFreeProviderDraft {
                contract_version: CONTRACT_VERSION,
                provider_name: "Test Provider".into(),
                endpoint: Some("https://api.example.test".into()),
                model_hint: Some("model-a".into()),
            })
            .expect("draft serializes"),
            serde_json::to_value(result).expect("validation serializes"),
            serde_json::to_value(VerificationState::Pending).expect("verification serializes"),
            serde_json::to_value(CcSwitchConflict::ProviderMissing).expect("conflict serializes"),
            serde_json::to_value(RecoveryState::Unneeded).expect("recovery serializes"),
        ];

        let serialized = serde_json::to_string(&values).expect("snapshot serializes");
        assert!(!serialized.contains(&canary));
    }
}
