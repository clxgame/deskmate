use serde_json::{Map, Value};

use crate::ccswitch::recovery::{
    read_observed_file, replace_file_if_unchanged, OpenCodeFile, OpenCodePaths,
};
use crate::ccswitch::verification::{ccswitch_generated_id_prefix, generated_id_generation};
use crate::settings::ModelCatalog;

use super::launch::CcSwitchCommandError;

/// What the expansion achieved, so the UI can tell the user the truth instead of
/// implying CC Switch already knows about the wider catalog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ModelCatalogSyncOutcome {
    /// Number of models present in the provider after the expansion.
    pub(crate) model_count: usize,
    /// True while CC Switch still has to re-import so its database matches.
    pub(crate) ccswitch_sync_required: bool,
}

fn sync_error(code: &'static str) -> CcSwitchCommandError {
    CcSwitchCommandError {
        code,
        message: "The verified model catalog could not be applied to OpenCode.",
    }
}

/// Expands the freshly imported YUME provider in the user's live OpenCode config
/// from the single deep-link model to the full verified catalog.
///
/// cc-switch v3.20.1 can only carry one model through `ccswitch://v1/import`
/// (`build_opencode_settings` inserts at most one `models` entry and the
/// `config` parameter is reduced to endpoint/key), so the remaining models are
/// written here and picked up by cc-switch's own
/// `import_opencode_providers_from_live` on its next start or manual import.
pub(crate) fn expand_provider_model_catalog(
    paths: &OpenCodePaths,
    provider_name: &str,
    endpoint: &str,
    selected_model: &str,
    catalog: &ModelCatalog,
) -> Result<ModelCatalogSyncOutcome, CcSwitchCommandError> {
    if catalog.models.is_empty() {
        return Err(sync_error("local_ai_model_catalog_missing"));
    }
    if !catalog
        .models
        .iter()
        .any(|model| model.id == selected_model)
    {
        return Err(sync_error("local_ai_model_catalog_missing"));
    }

    let observed =
        read_observed_file(paths, OpenCodeFile::Config).map_err(|_| write_failed_error())?;
    let bytes = observed
        .bytes
        .as_deref()
        .ok_or_else(|| sync_error("local_ai_model_catalog_provider_not_found"))?;
    let mut document: Value = serde_json::from_slice(bytes).map_err(|_| write_failed_error())?;

    let provider_id = locate_provider_id(&document, provider_name, endpoint, selected_model)
        .ok_or_else(|| sync_error("local_ai_model_catalog_provider_not_found"))?;

    let models = catalog_models(catalog);
    let model_count = models.len();
    let provider = document
        .get_mut("provider")
        .and_then(Value::as_object_mut)
        .and_then(|providers| providers.get_mut(&provider_id))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| sync_error("local_ai_model_catalog_provider_not_found"))?;
    if provider.get("models").and_then(Value::as_object) == Some(&models) {
        return Ok(ModelCatalogSyncOutcome {
            model_count,
            ccswitch_sync_required: true,
        });
    }
    provider.insert("models".to_owned(), Value::Object(models));

    // `serde_json` serializes maps in sorted-key order with the same two-space
    // indentation cc-switch itself writes, so untouched providers round-trip
    // byte for byte.
    let serialized = serde_json::to_vec_pretty(&document).map_err(|_| write_failed_error())?;
    replace_file_if_unchanged(
        paths.home(),
        paths.config(),
        &observed.observation,
        &serialized,
    )
    .map_err(|_| write_failed_error())?;

    Ok(ModelCatalogSyncOutcome {
        model_count,
        ccswitch_sync_required: true,
    })
}

fn write_failed_error() -> CcSwitchCommandError {
    sync_error("local_ai_model_catalog_write_failed")
}

fn catalog_models(catalog: &ModelCatalog) -> Map<String, Value> {
    catalog
        .models
        .iter()
        .map(|model| (model.id.clone(), serde_json::json!({ "name": model.name })))
        .collect()
}

/// Finds the newest `<sanitized-name>-<millis>` provider that carries the
/// endpoint and model we just handed to CC Switch. Anything else - including a
/// pre-existing provider that merely shares the same gateway and model - is
/// left alone.
fn locate_provider_id(
    document: &Value,
    provider_name: &str,
    endpoint: &str,
    selected_model: &str,
) -> Option<String> {
    let providers = document.get("provider")?.as_object()?;
    let expected_endpoint = normalize_endpoint(endpoint)?;
    let prefix = ccswitch_generated_id_prefix(provider_name);
    let mut best: Option<(u64, String)> = None;
    for (provider_id, provider) in providers {
        let Some(generation) = generated_id_generation(provider_id, &prefix) else {
            continue;
        };
        let endpoint_matches = provider
            .get("options")
            .and_then(|options| options.get("baseURL"))
            .and_then(Value::as_str)
            .and_then(normalize_endpoint)
            .is_some_and(|actual| actual == expected_endpoint);
        if !endpoint_matches {
            continue;
        }
        let carries_model = provider
            .get("models")
            .and_then(Value::as_object)
            .is_some_and(|models| models.contains_key(selected_model));
        if !carries_model {
            continue;
        }
        if best.as_ref().is_none_or(|(best, _)| generation > *best) {
            best = Some((generation, provider_id.clone()));
        }
    }
    best.map(|(_, provider_id)| provider_id)
}

fn normalize_endpoint(value: &str) -> Option<String> {
    let mut parsed = url::Url::parse(value.trim()).ok()?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return None;
    }
    let trimmed = parsed.path().trim_end_matches('/').to_owned();
    parsed.set_path(&trimmed);
    Some(parsed.to_string().trim_end_matches('/').to_owned())
}

/// Resolves the paths plus the verified catalog, then expands the provider.
///
/// The catalog is re-read from the same source `prepare_automatic_deployment`
/// uses rather than threaded through the handoff receipt, so the ticket
/// contract stays untouched.
#[cfg(windows)]
pub(crate) fn expand_deployed_provider_catalog(
    app: &tauri::AppHandle,
    provider_name: &str,
    endpoint: &str,
    selected_model: &str,
) -> Result<ModelCatalogSyncOutcome, CcSwitchCommandError> {
    use tauri::Manager as _;

    use crate::settings::SettingsState;

    let base_url = app
        .state::<SettingsState>()
        .0
        .lock()
        .map_err(|_| sync_error("local_ai_model_catalog_missing"))?
        .base_url
        .clone();
    let api_key = crate::settings::saved_api_key();
    let catalog = crate::settings::load_verified_model_catalog(app, &base_url, &api_key)
        .ok_or_else(|| sync_error("local_ai_model_catalog_missing"))?;
    let paths = super::recovery_manager(app)?;
    expand_provider_model_catalog(
        paths.paths(),
        provider_name,
        endpoint,
        selected_model,
        &catalog,
    )
}

#[cfg(test)]
mod tests;
