use super::WorkbenchOwnership;

#[test]
fn hidden_host_cannot_reclaim_from_still_visible_document() {
    // Given a host window hidden after owning a session.
    let ownership = WorkbenchOwnership::default();
    ownership.set_host_visible(true).unwrap();
    ownership.claim_visible("C:/one", "ses_same", true).unwrap();
    ownership.set_host_visible(false).unwrap();
    // When its stale page attempts to reclaim with an earlier visible observation.
    let result = ownership.claim_visible("C:/one", "ses_same", true);
    // Then the hidden host cannot own the session.
    assert!(result.is_err());
    assert!(!ownership.is_owned("C:/one", "ses_same").unwrap());
}

#[test]
fn actual_hidden_host_cannot_refresh_a_lease() {
    // Given a visible lease whose native window has become hidden.
    let ownership = WorkbenchOwnership::default();
    ownership.set_host_visible(true).unwrap();
    ownership.claim_visible("C:/one", "ses_same", true).unwrap();
    // When the host rejects the document's visible heartbeat.
    let refreshed = ownership.heartbeat_visible("C:/one", "ses_same", false).unwrap();
    // Then no ownership remains.
    assert!(!refreshed);
    assert!(!ownership.is_owned("C:/one", "ses_same").unwrap());
}

#[test]
fn showing_host_allows_same_session_to_be_claimed_again() {
    // Given a previously hidden workbench with its page retained.
    let ownership = WorkbenchOwnership::default();
    ownership.set_host_visible(false).unwrap();
    // When the native window is shown and its page claims the same session.
    ownership.set_host_visible(true).unwrap();
    ownership.claim_visible("C:/one", "ses_same", true).unwrap();
    // Then claim and heartbeat work normally.
    assert!(ownership.is_owned("C:/one", "ses_same").unwrap());
    assert!(ownership.heartbeat_visible("C:/one", "ses_same", true).unwrap());
}
