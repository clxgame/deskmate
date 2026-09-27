use std::borrow::Cow;
use url::Url;

pub const DEFAULT_AI_BASE_URL: &str = "https://ai-gateway.kurogames.com";
const LEGACY_KURO_PROVIDER_ID: &str = "kuro";

pub fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_owned()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ApiProtocol {
    OpenAiCompatible,
    OpenAi,
    Anthropic,
    Gemini,
    Cohere,
}

pub(super) fn api_protocol(base_url: &str) -> ApiProtocol {
    let Ok(url) = Url::parse(base_url) else {
        return ApiProtocol::OpenAiCompatible;
    };
    if url.scheme() != "https" || url.port().is_some() {
        return ApiProtocol::OpenAiCompatible;
    }
    let path = url.path().trim_end_matches('/');
    match (url.host_str(), path) {
        (Some("api.openai.com"), "" | "/v1") => ApiProtocol::OpenAi,
        (Some("api.anthropic.com"), "" | "/v1") => ApiProtocol::Anthropic,
        (Some("generativelanguage.googleapis.com"), "" | "/v1beta" | "/v1") => ApiProtocol::Gemini,
        (Some("api.cohere.com"), "" | "/v1" | "/v2") => ApiProtocol::Cohere,
        _ => ApiProtocol::OpenAiCompatible,
    }
}

pub(super) fn model_list_url(base_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim()).map_err(|_| "bad_url".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("bad_url".into());
    }
    let protocol = api_protocol(base_url);
    let path = url.path().trim_end_matches('/');
    let models_path = match protocol {
        ApiProtocol::Cohere => "/v1/models".to_string(),
        ApiProtocol::Gemini => {
            format!("{}/models", if path.is_empty() { "/v1beta" } else { path })
        }
        ApiProtocol::Anthropic | ApiProtocol::OpenAi => {
            format!("{}/models", if path.is_empty() { "/v1" } else { path })
        }
        ApiProtocol::OpenAiCompatible => {
            format!("{}/models", if path.is_empty() { "/v1" } else { path })
        }
    };
    url.set_path(&models_path);
    Ok(url)
}

pub(super) fn sidecar_base_url(base_url: &str) -> String {
    let base = normalize_base_url(base_url);
    match api_protocol(&base) {
        ApiProtocol::OpenAi if base == "https://api.openai.com" => format!("{base}/v1"),
        ApiProtocol::Anthropic if base == "https://api.anthropic.com" => format!("{base}/v1"),
        ApiProtocol::Gemini if base == "https://generativelanguage.googleapis.com" => {
            format!("{base}/v1beta")
        }
        ApiProtocol::Cohere if base == "https://api.cohere.com" || base == "https://api.cohere.com/v1" => {
            "https://api.cohere.com/v2".into()
        }
        _ => base,
    }
}

pub fn migrated_ai_base_url<'a>(provider_id: &str, raw: &'a str) -> Cow<'a, str> {
    let normalized = normalize_base_url(raw);
    let is_legacy_sidecar_url = provider_id.eq_ignore_ascii_case(LEGACY_KURO_PROVIDER_ID)
        && url::Url::parse(&normalized).ok().is_some_and(|parsed| {
            parsed.scheme() == "http"
                && parsed.host_str() == Some("127.0.0.1")
                && parsed.port().is_some()
                && parsed.path() == "/"
                && parsed.query().is_none()
                && parsed.fragment().is_none()
                && parsed.username().is_empty()
                && parsed.password().is_none()
        });

    if is_legacy_sidecar_url {
        Cow::Borrowed(DEFAULT_AI_BASE_URL)
    } else {
        Cow::Borrowed(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        api_protocol, migrated_ai_base_url, model_list_url, sidecar_base_url, ApiProtocol,
        DEFAULT_AI_BASE_URL,
    };

    #[test]
    fn discovers_models_at_the_configured_api_prefix() {
        assert_eq!(
            model_list_url("https://api.deepseek.com").unwrap().as_str(),
            "https://api.deepseek.com/v1/models"
        );
        assert_eq!(
            model_list_url("https://api.moonshot.ai/v1")
                .unwrap()
                .as_str(),
            "https://api.moonshot.ai/v1/models"
        );
        assert_eq!(
            model_list_url("https://open.bigmodel.cn/api/paas/v4")
                .unwrap()
                .as_str(),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
        assert_eq!(
            model_list_url("https://api.anthropic.com")
                .unwrap()
                .as_str(),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            model_list_url("https://generativelanguage.googleapis.com")
                .unwrap()
                .as_str(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(model_list_url("https://api.cohere.com/v2").unwrap().as_str(), "https://api.cohere.com/v1/models");
        assert!(model_list_url("https://api.openai.com/v1?token=secret").is_err());
    }

    #[test]
    fn recognizes_only_official_native_api_hosts() {
        assert_eq!(
            api_protocol("https://api.anthropic.com"),
            ApiProtocol::Anthropic
        );
        assert_eq!(
            api_protocol("https://generativelanguage.googleapis.com/v1beta"),
            ApiProtocol::Gemini
        );
        assert_eq!(
            api_protocol("https://api.anthropic.com.evil.test"),
            ApiProtocol::OpenAiCompatible
        );
        assert_eq!(
            sidecar_base_url("https://api.anthropic.com"),
            "https://api.anthropic.com/v1"
        );
        assert_eq!(sidecar_base_url("https://api.cohere.com"), "https://api.cohere.com/v2");
    }

    #[test]
    fn migrates_legacy_kuro_provider_when_base_url_is_a_dead_yume_sidecar_port() {
        // Given
        let provider_id = "kuro";
        let stale_base_url = "http://127.0.0.1:48731";

        // When
        let migrated = migrated_ai_base_url(provider_id, stale_base_url);

        // Then
        assert_eq!(migrated, DEFAULT_AI_BASE_URL);
    }

    #[test]
    fn preserves_current_yume_provider_when_user_intentionally_uses_loopback() {
        // Given
        let provider_id = "yume";
        let local_base_url = "http://127.0.0.1:48731";

        // When
        let migrated = migrated_ai_base_url(provider_id, local_base_url);

        // Then
        assert_eq!(migrated, local_base_url);
    }

    #[test]
    fn preserves_legacy_provider_when_base_url_is_remote() {
        // Given
        let provider_id = "kuro";
        let remote_base_url = "https://models.example.test/v1";

        // When
        let migrated = migrated_ai_base_url(provider_id, remote_base_url);

        // Then
        assert_eq!(migrated, remote_base_url);
    }
}
