pub(crate) fn is_allowed(identifier: &str) -> bool {
    identifier == "com.deskmate.worklogqa"
        || identifier
            .strip_prefix("com.deskmate.unifiedhistoryqa.")
            .is_some_and(|suffix| {
                !suffix.is_empty()
                    && suffix.len() <= 30
                    && suffix
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
}

static KEYRING_SCOPE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub(crate) fn initialize_keyring(identifier: &str) -> Result<(), String> {
    if !is_allowed(identifier) {
        return Err("QA identity is not in the isolated allowlist".into());
    }
    if KEYRING_SCOPE.get_or_init(|| identifier.to_owned()) != identifier {
        return Err("QA credential scope cannot change within a process".into());
    }
    Ok(())
}

pub(crate) fn keyring_scope() -> &'static str {
    KEYRING_SCOPE
        .get()
        .map_or("com.deskmate.worklogqa", String::as_str)
}

#[cfg(test)]
mod tests {
    #[test]
    fn isolates_credentials_when_fresh_qa_identity_initializes_twice() {
        assert!(super::initialize_keyring("com.deskmate.desktop").is_err());
        let identity = "com.deskmate.unifiedhistoryqa.keyringtest";
        assert!(super::initialize_keyring(identity).is_ok());
        assert!(super::initialize_keyring(identity).is_ok());
        assert_eq!(super::keyring_scope(), identity);
        assert!(super::initialize_keyring("com.deskmate.worklogqa").is_err());
    }

    #[test]
    fn accepts_a_fresh_qa_identity_when_suffix_is_bounded_ascii() {
        assert!(super::is_allowed(
            "com.deskmate.unifiedhistoryqa.run20260924"
        ));
        assert!(super::is_allowed("com.deskmate.worklogqa"));
    }

    #[test]
    fn rejects_production_and_path_shaped_identity_when_selecting_qa_storage() {
        for identifier in [
            "com.deskmate.desktop",
            "com.deskmate.unifiedhistoryqa.",
            "com.deskmate.unifiedhistoryqa../desktop",
            "com.deskmate.unifiedhistoryqa.run\\desktop",
            "com.deskmate.unifiedhistoryqa.run.desktop",
            "com.deskmate.unifiedhistoryqa.RUN",
            "com.deskmate.unifiedhistoryqa.123456789012345678901234567890123",
        ] {
            assert!(!super::is_allowed(identifier), "accepted {identifier}");
        }
    }
}
