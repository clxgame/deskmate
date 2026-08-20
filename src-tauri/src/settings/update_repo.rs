use std::borrow::Cow;

pub const DEFAULT_UPDATE_REPO: &str = "clxgame/deskmate";

const MIGRATED_UPDATE_REPOS: &[&str] = &["clx/deskmate", "yourname/deskmate"];

pub fn migrated_update_repo(raw: &str) -> Cow<'_, str> {
    let normalized = raw.trim().trim_end_matches('/');
    let github_slug = url::Url::parse(normalized).ok().and_then(|parsed| {
        (parsed.scheme() == "https"
            && parsed.host_str() == Some("github.com")
            && parsed.query().is_none()
            && parsed.fragment().is_none())
        .then(|| parsed.path().trim_matches('/').to_owned())
    });
    let slug = github_slug.as_deref().unwrap_or(normalized);
    let repo = slug.strip_suffix(".git").map_or(slug, |value| value);
    let should_migrate = repo.is_empty()
        || MIGRATED_UPDATE_REPOS
            .iter()
            .any(|legacy| repo.eq_ignore_ascii_case(legacy));

    if should_migrate {
        Cow::Borrowed(DEFAULT_UPDATE_REPO)
    } else {
        Cow::Borrowed(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::{migrated_update_repo, DEFAULT_UPDATE_REPO};

    #[test]
    fn keeps_custom_repo_when_valid_custom_repo_is_saved() {
        // Given
        let raw = "openai/deskmate";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, raw);
    }

    #[test]
    fn migrates_legacy_default_repo_when_old_settings_are_loaded() {
        // Given
        let raw = "clx/deskmate";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, DEFAULT_UPDATE_REPO);
    }

    #[test]
    fn migrates_legacy_full_github_url_when_old_settings_are_loaded() {
        // Given
        let raw = "https://github.com/clx/deskmate.git/";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, DEFAULT_UPDATE_REPO);
    }

    #[test]
    fn migrates_placeholder_repo_when_template_settings_are_loaded() {
        // Given
        let raw = "yourname/deskmate";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, DEFAULT_UPDATE_REPO);
    }

    #[test]
    fn migrates_empty_repo_when_blank_settings_are_loaded() {
        // Given
        let raw = "  ";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, DEFAULT_UPDATE_REPO);
    }

    #[test]
    fn migration_is_idempotent_when_new_default_is_loaded() {
        // Given
        let raw = DEFAULT_UPDATE_REPO;

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, DEFAULT_UPDATE_REPO);
    }

    #[test]
    fn preserves_malformed_repo_when_user_must_fix_it() {
        // Given
        let raw = "not a repo";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, raw);
    }

    #[test]
    fn preserves_custom_full_github_url() {
        // Given
        let raw = "https://github.com/openai/deskmate";

        // When
        let migrated = migrated_update_repo(raw);

        // Then
        assert_eq!(migrated, raw);
    }
}
