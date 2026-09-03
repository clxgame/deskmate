use std::borrow::Cow;

pub const DEFAULT_AI_BASE_URL: &str = "https://ai-gateway.kurogames.com";
const LEGACY_KURO_PROVIDER_ID: &str = "kuro";

pub fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_owned()
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
    use super::{migrated_ai_base_url, DEFAULT_AI_BASE_URL};

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
