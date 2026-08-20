use super::Repository;

#[test]
fn repository_endpoint_when_owner_and_name_are_valid() {
    // Given
    let raw = "openai/deskmate";

    // When
    let endpoint = Repository::parse(raw).and_then(|repo| repo.endpoint());

    // Then
    assert_eq!(
        endpoint.map(|url| url.to_string()),
        Ok("https://github.com/openai/deskmate/releases/latest/download/latest.json".to_string())
    );
}

#[test]
fn repository_endpoint_when_full_github_url_is_pasted() {
    // Given
    let raw = "https://github.com/openai/deskmate/";

    // When
    let endpoint = Repository::parse(raw).and_then(|repo| repo.endpoint());

    // Then
    assert_eq!(
        endpoint.map(|url| url.to_string()),
        Ok("https://github.com/openai/deskmate/releases/latest/download/latest.json".to_string())
    );
}

#[test]
fn repository_is_rejected_when_input_is_a_placeholder() {
    // Given
    let raw = "yourname/deskmate";

    // When
    let result = Repository::parse(raw);

    // Then
    assert_eq!(
        result.expect_err("placeholder must fail").code(),
        "placeholder"
    );
}

#[test]
fn repository_is_rejected_when_path_has_extra_segments() {
    // Given
    let raw = "openai/deskmate/releases/latest";

    // When
    let result = Repository::parse(raw);

    // Then
    assert_eq!(
        result.expect_err("extra path must fail").code(),
        "invalid_repo"
    );
}
