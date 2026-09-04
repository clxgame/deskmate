use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value};

use super::super::*;
use crate::settings::{ApiModel, ModelCatalog};

pub(super) const ENDPOINT: &str = "https://ai-gateway.kurogames.com";
pub(super) const PROVIDER_NAME: &str = "YUME OpenCode";
pub(super) const SELECTED: &str = "claude-opus-5";
pub(super) const YUME_ID: &str = "yumeopencode-1788485462290";

pub(super) struct Home {
    root: PathBuf,
}

impl Home {
    /// Mirrors the real machine: `kuro` and `omo-kuro` share YUME's gateway
    /// and already carry the selected model, so a lax match would clobber
    /// them.
    pub(super) fn new(document: &Value) -> Self {
        let root = std::env::temp_dir().join(format!("yume-catalog-{}", uuid::Uuid::new_v4()));
        let config = root.join(".config").join("opencode");
        let auth = root.join(".local").join("share").join("opencode");
        fs::create_dir_all(&config).expect("create config directory");
        fs::create_dir_all(&auth).expect("create auth directory");
        fs::write(auth.join("auth.json"), b"{}").expect("write auth");
        fs::write(
            config.join("opencode.json"),
            serde_json::to_vec_pretty(document).expect("serialize document"),
        )
        .expect("write config");
        Self { root }
    }

    pub(super) fn paths(&self) -> OpenCodePaths {
        OpenCodePaths::from_home(&self.root).expect("accept home")
    }

    pub(super) fn config_path(&self) -> PathBuf {
        self.root
            .join(".config")
            .join("opencode")
            .join("opencode.json")
    }

    pub(super) fn raw(&self) -> Vec<u8> {
        fs::read(self.config_path()).expect("read config")
    }

    pub(super) fn document(&self) -> Value {
        serde_json::from_slice(&self.raw()).expect("parse config")
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(super) fn wide_models() -> Value {
    serde_json::json!({
        "claude-opus-5": { "name": "claude-opus-5" },
        "gpt-5.4-mini": { "name": "gpt-5.4-mini" },
        "kimi-k3": { "name": "kimi-k3" },
    })
}

pub(super) fn neighbours() -> Map<String, Value> {
    let mut providers = Map::new();
    providers.insert(
        "kuro".to_owned(),
        serde_json::json!({
            "models": wide_models(),
            "npm": "@ai-sdk/openai-compatible",
            "options": {
                "apiKey": "kuro-neighbour-key",
                "baseURL": ENDPOINT,
                "setCacheKey": true,
            },
        }),
    );
    providers.insert(
        "omo-kuro".to_owned(),
        serde_json::json!({
            "models": wide_models(),
            "npm": "@ai-sdk/openai-compatible",
            "options": {
                "apiKey": "omo-neighbour-key",
                "baseURL": ENDPOINT,
                "setCacheKey": true,
            },
        }),
    );
    providers.insert(
        "omo-8b173b85-2a06-41ac-863e-3b9d9df198e0".to_owned(),
        serde_json::json!({ "agents": {}, "categories": {} }),
    );
    providers
}

pub(super) fn yume_provider(model: &str) -> Value {
    serde_json::json!({
        "models": { model: { "name": model } },
        "npm": "@ai-sdk/openai-compatible",
        "options": {
            "apiKey": "yume-deeplink-key",
            "baseURL": ENDPOINT,
        },
    })
}

pub(super) fn document_with(extra: Vec<(String, Value)>) -> Value {
    let mut providers = neighbours();
    for (id, provider) in extra {
        providers.insert(id, provider);
    }
    serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "model": "omo-kuro/deepseek-v4-flash",
        "provider": Value::Object(providers),
    })
}

pub(super) fn catalog(ids: &[&str]) -> ModelCatalog {
    ModelCatalog {
        base_url: ENDPOINT.to_owned(),
        api_key_fingerprint: "a".repeat(64),
        models: ids
            .iter()
            .map(|id| ApiModel {
                id: (*id).to_owned(),
                name: (*id).to_owned(),
            })
            .collect(),
    }
}

pub(super) fn full_catalog() -> ModelCatalog {
    catalog(&[SELECTED, "gpt-5.4-mini", "kimi-k3", "qwen3.8-max"])
}

pub(super) fn expand(
    home: &Home,
    catalog: &ModelCatalog,
) -> Result<ModelCatalogSyncOutcome, CcSwitchCommandError> {
    expand_provider_model_catalog(&home.paths(), PROVIDER_NAME, ENDPOINT, SELECTED, catalog)
}

pub(super) fn provider_of<'a>(document: &'a Value, id: &str) -> &'a Value {
    document
        .get("provider")
        .and_then(|providers| providers.get(id))
        .expect("provider present")
}

pub(super) fn model_ids(document: &Value, id: &str) -> Vec<String> {
    let mut ids = provider_of(document, id)
        .get("models")
        .and_then(Value::as_object)
        .expect("models object")
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    ids.sort();
    ids
}
