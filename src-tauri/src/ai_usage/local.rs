use crate::settings::SettingsState;
use chrono::{DateTime, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::{Manager, State};

const LEDGER_FILE: &str = "ai-usage-local.json";
static LEDGER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CAPTURED_AGENT_MESSAGES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageObservation {
    message_id: String,
    sidecar_id: String,
    model_id: String,
    created_at_ms: i64,
    tokens: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct StoredUsage {
    provider_id: String,
    model_id: String,
    created_at_ms: i64,
    tokens: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageModel {
    name: String,
    tokens: u64,
    requests: u64,
}

#[derive(Default)]
pub(crate) struct LocalSummary {
    pub(crate) tokens: u64,
    pub(crate) requests: u64,
    pub(crate) top_models: Vec<LocalUsageModel>,
}

fn ledger_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    LEDGER_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "usage_storage_unavailable".into())
}

fn read_ledger(root: &Path) -> Result<HashMap<String, StoredUsage>, String> {
    match fs::read(root.join(LEDGER_FILE)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "usage_storage_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(_) => Err("usage_storage_unavailable".into()),
    }
}

fn save_ledger(root: &Path, entries: &HashMap<String, StoredUsage>) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|_| "usage_storage_unavailable")?;
    let pending = root.join(format!(".{LEDGER_FILE}-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(entries).map_err(|_| "usage_storage_invalid")?;
    fs::write(&pending, bytes).map_err(|_| "usage_storage_unavailable")?;
    fs::rename(&pending, root.join(LEDGER_FILE)).map_err(|_| "usage_storage_unavailable".into())
}

fn valid_observation(observation: &UsageObservation) -> bool {
    !observation.message_id.is_empty()
        && observation.message_id.len() <= 200
        && !observation.model_id.is_empty()
        && observation.model_id.len() <= 200
        && observation.tokens <= 100_000_000
        && observation.created_at_ms > 0
}

fn save_observations(
    root: &Path,
    providers: &[crate::settings::AiProvider],
    observations: impl IntoIterator<Item = UsageObservation>,
) -> Result<(), String> {
    let _guard = ledger_lock()?;
    let mut entries = read_ledger(root)?;
    let mut changed = false;
    for observation in observations {
        if !valid_observation(&observation) {
            continue;
        }
        let Some(provider) = providers.iter().find(|provider| {
            provider.sidecar_id == observation.sidecar_id
                && super::is_deepseek_base_url(&provider.base_url)
        }) else {
            continue;
        };
        let next = StoredUsage {
            provider_id: provider.id.clone(),
            model_id: observation.model_id,
            created_at_ms: observation.created_at_ms,
            tokens: observation.tokens,
        };
        if entries
            .get(&observation.message_id)
            .is_none_or(|existing| existing.tokens < next.tokens)
        {
            entries.insert(observation.message_id, next);
            changed = true;
        }
    }
    if changed {
        save_ledger(root, &entries)?;
    }
    Ok(())
}

pub(crate) fn today_summary(root: &Path, provider_id: &str) -> Result<LocalSummary, String> {
    let _guard = ledger_lock()?;
    let today = Local::now().date_naive();
    let mut summary = LocalSummary {
        tokens: 0,
        requests: 0,
        top_models: Vec::new(),
    };
    let mut models: HashMap<String, (u64, u64)> = HashMap::new();
    for entry in read_ledger(root)?.values() {
        let created: Option<DateTime<Local>> =
            Local.timestamp_millis_opt(entry.created_at_ms).single();
        if entry.provider_id != provider_id || created.is_none_or(|time| time.date_naive() != today)
        {
            continue;
        }
        summary.tokens = summary.tokens.saturating_add(entry.tokens);
        summary.requests += 1;
        let model = models.entry(entry.model_id.clone()).or_default();
        model.0 = model.0.saturating_add(entry.tokens);
        model.1 += 1;
    }
    summary.top_models = models
        .into_iter()
        .map(|(name, (tokens, requests))| LocalUsageModel {
            name,
            tokens,
            requests,
        })
        .collect();
    summary.top_models.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    summary.top_models.truncate(3);
    Ok(summary)
}

#[tauri::command]
pub(crate) async fn record_ai_usage(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    observation: UsageObservation,
) -> Result<(), String> {
    let providers = state
        .0
        .lock()
        .map_err(|_| "settings_state")?
        .providers
        .clone();
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "usage_storage_unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        save_observations(&root, &providers, [observation])
    })
    .await
    .map_err(|_| "usage_storage_unavailable".to_string())?
}

fn observation_from_wire(message: &serde_json::Value) -> Option<UsageObservation> {
    let info = message.get("info")?;
    if info.get("role")?.as_str()? != "assistant" || info.get("time")?.get("completed").is_none() {
        return None;
    }
    let tokens = info.get("tokens")?;
    let count = |field: &str| {
        tokens
            .get(field)
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    };
    let cache = tokens.get("cache");
    let cached = |field: &str| {
        cache
            .and_then(|value| value.get(field))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    };
    Some(UsageObservation {
        message_id: info.get("id")?.as_str()?.to_owned(),
        sidecar_id: info.get("providerID")?.as_str()?.to_owned(),
        model_id: info.get("modelID")?.as_str()?.to_owned(),
        created_at_ms: info.get("time")?.get("created")?.as_i64()?,
        tokens: count("input")
            .saturating_add(count("output"))
            .saturating_add(count("reasoning"))
            .saturating_add(cached("read"))
            .saturating_add(cached("write")),
    })
}

pub(crate) fn capture_agent_usage(
    app: &tauri::AppHandle,
    directory: &Path,
    session_id: &str,
    snapshot: &[crate::agent::NativeMessage],
) -> Result<(), String> {
    let completed = snapshot
        .iter()
        .filter(|message| message.role.as_deref() == Some("assistant") && message.completed)
        .map(|message| message.id.clone())
        .collect::<Vec<_>>();
    if completed.is_empty() {
        return Ok(());
    }
    let captured = CAPTURED_AGENT_MESSAGES.get_or_init(|| Mutex::new(HashSet::new()));
    let seen = captured.lock().map_err(|_| "usage_storage_unavailable")?;
    if completed.iter().all(|id| seen.contains(id)) {
        return Ok(());
    }
    drop(seen);
    let settings = app.state::<SettingsState>();
    let providers = settings
        .0
        .lock()
        .map_err(|_| "settings_state")?
        .providers
        .clone();
    if !providers
        .iter()
        .any(|provider| super::is_deepseek_base_url(&provider.base_url))
    {
        return Ok(());
    }
    let mut url = url::Url::parse(&format!(
        "{}/session/{session_id}/message",
        crate::sidecar_url(app)
    ))
    .map_err(|_| "usage_sidecar_unavailable")?;
    url.query_pairs_mut().append_pair(
        "directory",
        &crate::agent::opencode_wire_directory(directory),
    );
    let messages: Vec<serde_json::Value> = ureq::get(url.as_str())
        .set("Authorization", &crate::sidecar_auth_header(app))
        .timeout(std::time::Duration::from_secs(8))
        .call()
        .map_err(|_| "usage_sidecar_unavailable")?
        .into_json()
        .map_err(|_| "usage_sidecar_invalid")?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "usage_storage_unavailable")?;
    save_observations(
        &root,
        &providers,
        messages.iter().filter_map(observation_from_wire),
    )?;
    captured
        .lock()
        .map_err(|_| "usage_storage_unavailable")?
        .extend(completed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AiProvider;

    #[test]
    fn reads_completed_assistant_usage_only() {
        let message = serde_json::json!({"info": {"id":"msg-1", "role":"assistant", "providerID":"yume", "modelID":"deepseek-flash", "time":{"created":1780000000000_i64,"completed":1780000001000_i64}, "tokens":{"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}}}});
        assert_eq!(observation_from_wire(&message).unwrap().tokens, 20);
        assert!(observation_from_wire(&serde_json::json!({"info":{"role":"user"}})).is_none());
    }

    #[test]
    fn local_ledger_deduplicates_messages_and_groups_by_provider() {
        let root =
            std::env::temp_dir().join(format!("yume-ai-usage-test-{}", uuid::Uuid::new_v4()));
        let provider = AiProvider {
            id: "deepseek-provider".into(),
            sidecar_id: "yume".into(),
            label: "DeepSeek".into(),
            base_url: "https://api.deepseek.com".into(),
            api_key: String::new(),
        };
        let observation = UsageObservation {
            message_id: "msg-1".into(),
            sidecar_id: "yume".into(),
            model_id: "deepseek-flash".into(),
            created_at_ms: Local::now().timestamp_millis(),
            tokens: 20,
        };
        save_observations(
            &root,
            &[provider.clone()],
            [observation.clone(), observation.clone()],
        )
        .unwrap();
        let first = today_summary(&root, &provider.id).unwrap();
        assert_eq!((first.tokens, first.requests), (20, 1));
        save_observations(
            &root,
            &[provider],
            [UsageObservation {
                tokens: 30,
                ..observation
            }],
        )
        .unwrap();
        let updated = today_summary(&root, "deepseek-provider").unwrap();
        assert_eq!((updated.tokens, updated.requests), (30, 1));
        assert_eq!(updated.top_models[0].name, "deepseek-flash");
        fs::remove_dir_all(root).unwrap();
    }
}
