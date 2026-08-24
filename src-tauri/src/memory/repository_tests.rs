//! Repository behavior tests. Every case runs against a real SQLite database.

use super::domain::{
    MemoryQuery, MemoryScope, MemoryStatus, MemoryType, MemoryUpdate, NewMemory, SourceKind,
};
use super::error::MemoryErrorCode;
use super::repository::{Clock, MemoryRepository};
use super::storage::MemoryStore;

/// A clock the tests advance by hand.
struct FixedClock {
    now: std::sync::Mutex<chrono::DateTime<chrono::Utc>>,
}

impl FixedClock {
    fn at(text: &str) -> Self {
        Self {
            now: std::sync::Mutex::new(
                chrono::DateTime::parse_from_rfc3339(text)
                    .expect("timestamp")
                    .with_timezone(&chrono::Utc),
            ),
        }
    }

    fn advance_hours(&self, hours: i64) {
        let mut guard = self.now.lock().expect("clock");
        *guard += chrono::Duration::hours(hours);
    }
}

impl Clock for FixedClock {
    fn now(&self) -> String {
        self.now
            .lock()
            .expect("clock")
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    }

    fn now_plus_hours(&self, hours: i64) -> String {
        (*self.now.lock().expect("clock") + chrono::Duration::hours(hours))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    }
}

fn repo() -> MemoryRepository<FixedClock> {
    MemoryRepository::new(
        MemoryStore::open_in_memory().expect("store"),
        FixedClock::at("2026-01-01T08:00:00Z"),
    )
}

fn global_preference(content: &str, key: Option<&str>) -> NewMemory {
    NewMemory {
        scope: MemoryScope::Global,
        persona_id: None,
        memory_type: MemoryType::Preference,
        memory_key: key.map(str::to_owned),
        content: content.into(),
        importance: None,
        expires_at: None,
        source_kind: SourceKind::Explicit,
        conversation_id: None,
        message_id: None,
        sensitive_confirmed: false,
    }
}

fn persona_moment(persona: &str, content: &str) -> NewMemory {
    NewMemory {
        scope: MemoryScope::Persona,
        persona_id: Some(persona.into()),
        memory_type: MemoryType::SharedMoment,
        memory_key: None,
        content: content.into(),
        importance: None,
        expires_at: None,
        source_kind: SourceKind::Explicit,
        conversation_id: None,
        message_id: None,
        sensitive_confirmed: false,
    }
}

#[test]
fn creates_an_explicit_global_memory_with_provenance() {
    let repo = repo();
    let mut request = global_preference("叫我小林", Some("identity.preferred_name"));
    request.memory_type = MemoryType::Identity;
    request.conversation_id = Some("ses_1".into());
    request.message_id = Some("msg_1".into());

    let created = repo.create(&request).expect("create");
    assert_eq!(created.status, MemoryStatus::Active);
    assert_eq!(created.revision, 1);
    assert_eq!(created.scope, MemoryScope::Global);
    assert_eq!(created.persona_id, None);

    let records = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(records.len(), 1);
    let source = &records[0].sources[0];
    assert_eq!(source.conversation_id.as_deref(), Some("ses_1"));
    assert_eq!(source.message_id.as_deref(), Some("msg_1"));
    assert!(records[0].linked_task_ids.is_empty());
}

#[test]
fn a_changed_stable_fact_supersedes_the_previous_value() {
    let repo = repo();
    let first = repo
        .create(&global_preference("不喜欢甜食", Some("food.sweets")))
        .expect("first");
    let second = repo
        .create(&global_preference("现在可以吃一点甜的", Some("food.sweets")))
        .expect("second");

    assert_eq!(second.supersedes_id.as_deref(), Some(first.id.as_str()));

    let active = repo.list(&MemoryQuery::default()).expect("active");
    assert_eq!(active.len(), 1, "only the current value stays active");
    assert_eq!(active[0].memory.id, second.id);

    let all = repo
        .list(&MemoryQuery {
            statuses: Some(vec![MemoryStatus::Active, MemoryStatus::Superseded]),
            ..MemoryQuery::default()
        })
        .expect("all");
    assert_eq!(all.len(), 2, "history stays inspectable");
}

#[test]
fn episodic_memories_append_instead_of_superseding() {
    let repo = repo();
    let mut first = global_preference("周五有答辩", None);
    first.memory_type = MemoryType::Event;
    let mut second = global_preference("下周一去打球", None);
    second.memory_type = MemoryType::Event;

    repo.create(&first).expect("first");
    repo.create(&second).expect("second");

    let records = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(records.len(), 2);
}

#[test]
fn rejects_secrets_and_writes_nothing() {
    let repo = repo();
    let error = repo
        .create(&global_preference("我的密码是 hunter2", None))
        .expect_err("secret must be rejected");
    assert_eq!(error.code(), MemoryErrorCode::SecretRejected);
    assert!(!error.message().contains("hunter2"));

    let records = repo
        .list(&MemoryQuery {
            statuses: Some(vec![
                MemoryStatus::Active,
                MemoryStatus::Superseded,
                MemoryStatus::Expired,
            ]),
            ..MemoryQuery::default()
        })
        .expect("list");
    assert!(records.is_empty(), "a rejected secret must not be stored");
}

#[test]
fn sensitive_content_is_stored_only_after_confirmation() {
    let repo = repo();
    let mut request = global_preference("月薪两万三", None);
    assert_eq!(
        repo.create(&request).expect_err("needs confirmation").code(),
        MemoryErrorCode::SensitiveConfirmationRequired
    );
    assert!(repo
        .list(&MemoryQuery::default())
        .expect("list")
        .is_empty());

    request.sensitive_confirmed = true;
    repo.create(&request).expect("confirmed");
    assert_eq!(repo.list(&MemoryQuery::default()).expect("list").len(), 1);
}

#[test]
fn a_stale_revision_conflicts_instead_of_overwriting() {
    let repo = repo();
    let created = repo
        .create(&global_preference("不喜欢甜食", Some("food.sweets")))
        .expect("create");

    let updated = repo
        .update(&MemoryUpdate {
            id: created.id.clone(),
            content: "不喜欢很甜的东西".into(),
            expected_revision: created.revision,
            importance: None,
            expires_at: None,
            sensitive_confirmed: false,
        })
        .expect("first update");
    assert_eq!(updated.revision, 2);

    // A second window still holding revision 1 must not clobber revision 2.
    let error = repo
        .update(&MemoryUpdate {
            id: created.id.clone(),
            content: "完全不吃甜的".into(),
            expected_revision: created.revision,
            importance: None,
            expires_at: None,
            sensitive_confirmed: false,
        })
        .expect_err("stale revision");
    assert_eq!(error.code(), MemoryErrorCode::Conflict);

    let records = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(records[0].memory.content, "不喜欢很甜的东西");
}

#[test]
fn updating_a_missing_memory_reports_not_found() {
    let repo = repo();
    let error = repo
        .update(&MemoryUpdate {
            id: "does-not-exist".into(),
            content: "x".into(),
            expected_revision: 1,
            importance: None,
            expires_at: None,
            sensitive_confirmed: false,
        })
        .expect_err("missing");
    assert_eq!(error.code(), MemoryErrorCode::NotFound);
}

#[test]
fn persona_memories_never_leak_to_another_persona() {
    let repo = repo();
    repo.create(&persona_moment("aimisi", "一起看了流星雨"))
        .expect("aimisi moment");
    repo.create(&global_preference("叫我小林", Some("identity.preferred_name")))
        .expect("global");

    let other = repo
        .list(&MemoryQuery {
            persona_id: Some("changli".into()),
            ..MemoryQuery::default()
        })
        .expect("changli view");
    assert_eq!(other.len(), 1, "only the global fact is visible");
    assert_eq!(other[0].memory.scope, MemoryScope::Global);

    let owner = repo
        .list(&MemoryQuery {
            persona_id: Some("aimisi".into()),
            ..MemoryQuery::default()
        })
        .expect("aimisi view");
    assert_eq!(owner.len(), 2, "owner sees its moment plus globals");
}

#[test]
fn expired_memories_drop_out_of_active_listings() {
    let repo = repo();
    let mut mood = global_preference("今天有点低落", None);
    mood.memory_type = MemoryType::Mood;
    repo.create(&mood).expect("mood");
    assert_eq!(repo.list(&MemoryQuery::default()).expect("list").len(), 1);

    repo.clock_advance(13);
    assert!(repo
        .list(&MemoryQuery::default())
        .expect("list")
        .is_empty());

    let expired = repo
        .list(&MemoryQuery {
            statuses: Some(vec![MemoryStatus::Expired]),
            ..MemoryQuery::default()
        })
        .expect("expired");
    assert_eq!(expired.len(), 1);
}

#[test]
fn search_matches_short_and_long_cjk_keywords() {
    let repo = repo();
    repo.create(&global_preference("不喜欢甜食", Some("food.sweets")))
        .expect("sweets");
    repo.create(&global_preference("每天七点起床", Some("routine.wake")))
        .expect("routine");

    // Two characters: below the trigram minimum, served by the LIKE fallback.
    let short = repo
        .list(&MemoryQuery {
            search: Some("甜食".into()),
            ..MemoryQuery::default()
        })
        .expect("short search");
    assert_eq!(short.len(), 1);
    assert_eq!(short[0].memory.content, "不喜欢甜食");

    // Three characters: served by the trigram FTS index.
    let long = repo
        .list(&MemoryQuery {
            search: Some("七点起".into()),
            ..MemoryQuery::default()
        })
        .expect("fts search");
    assert_eq!(long.len(), 1);
    assert_eq!(long[0].memory.content, "每天七点起床");

    // Stable keys are searchable too.
    let by_key = repo
        .list(&MemoryQuery {
            search: Some("routine".into()),
            ..MemoryQuery::default()
        })
        .expect("key search");
    assert_eq!(by_key.len(), 1);
}

#[test]
fn search_input_cannot_inject_fts_or_like_syntax() {
    let repo = repo();
    repo.create(&global_preference("不喜欢甜食", Some("food.sweets")))
        .expect("sweets");

    for hostile in ["\"OR NEAR( *", "content: OR 1=1", "%"] {
        let result = repo
            .list(&MemoryQuery {
                search: Some(hostile.into()),
                ..MemoryQuery::default()
            })
            .unwrap_or_else(|error| panic!("hostile search {hostile} errored: {error}"));
        assert!(
            result.is_empty(),
            "hostile search {hostile} matched unrelated rows"
        );
    }
}

#[test]
fn forget_hard_deletes_content_and_leaves_only_audit_metadata() {
    let repo = repo();
    let created = repo
        .create(&global_preference("不喜欢甜食", Some("food.sweets")))
        .expect("create");

    repo.forget(&created.id).expect("forget");

    assert!(repo
        .list(&MemoryQuery {
            statuses: Some(vec![
                MemoryStatus::Active,
                MemoryStatus::Superseded,
                MemoryStatus::Expired
            ]),
            ..MemoryQuery::default()
        })
        .expect("list")
        .is_empty());

    repo.store()
        .with_connection(|connection| {
            for table in ["memories", "memory_sources", "memory_search"] {
                let count: i64 = connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                    .expect("count");
                assert_eq!(count, 0, "{table} still holds forgotten content");
            }
            let events: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_events WHERE action = 'forgotten'",
                    [],
                    |row| row.get(0),
                )
                .expect("events");
            assert_eq!(events, 1, "the action itself is still auditable");
            Ok(())
        })
        .expect("inspect");
}

#[test]
fn clearing_a_persona_keeps_global_and_other_personas() {
    let repo = repo();
    repo.create(&persona_moment("aimisi", "一起看了流星雨"))
        .expect("aimisi");
    repo.create(&persona_moment("changli", "一起听了雨声"))
        .expect("changli");
    repo.create(&global_preference("叫我小林", Some("identity.preferred_name")))
        .expect("global");

    let removed = repo
        .clear(Some(MemoryScope::Persona), Some("aimisi"))
        .expect("clear persona");
    assert_eq!(removed, 1);

    let remaining = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(remaining.len(), 2);
    assert!(remaining
        .iter()
        .all(|record| record.memory.persona_id.as_deref() != Some("aimisi")));
}

#[test]
fn clearing_everything_empties_every_content_table() {
    let repo = repo();
    repo.create(&persona_moment("aimisi", "一起看了流星雨"))
        .expect("moment");
    repo.create(&global_preference("叫我小林", Some("identity.preferred_name")))
        .expect("global");
    repo.relationship("aimisi").expect("relationship");

    repo.clear(None, None).expect("clear all");

    repo.store()
        .with_connection(|connection| {
            for table in [
                "memories",
                "memory_sources",
                "memory_search",
                "memory_candidates",
                "relationship_states",
                "memory_task_links",
            ] {
                let count: i64 = connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                    .expect("count");
                assert_eq!(count, 0, "{table} survived clear-all");
            }
            Ok(())
        })
        .expect("inspect");
}

#[test]
fn deleting_a_conversation_removes_only_its_sole_source_memories() {
    let repo = repo();

    let mut only_here = global_preference("周五有答辩", None);
    only_here.memory_type = MemoryType::Event;
    only_here.conversation_id = Some("ses_1".into());
    only_here.message_id = Some("msg_1".into());
    let derived = repo.create(&only_here).expect("derived");

    let mut also_elsewhere = global_preference("每天七点起床", Some("routine.wake"));
    also_elsewhere.conversation_id = Some("ses_1".into());
    also_elsewhere.message_id = Some("msg_2".into());
    let shared = repo.create(&also_elsewhere).expect("shared");
    // The same fact reconfirmed in another conversation.
    repo.store()
        .with_transaction(|tx| {
            tx.execute(
                "INSERT INTO memory_sources (id, memory_id, conversation_id, message_id, source_kind, created_at) \
                 VALUES ('s-extra', ?1, 'ses_2', 'msg_9', 'explicit', '2026-01-01T09:00:00Z')",
                rusqlite::params![shared.id],
            )
            .map_err(|error| super::error::MemoryError::storage_unavailable(error.to_string()))?;
            Ok(())
        })
        .expect("second source");

    let removed = repo.forget_conversation("ses_1").expect("forget conversation");
    assert_eq!(removed, 1);

    let remaining = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].memory.id, shared.id);
    assert!(
        !remaining[0]
            .sources
            .iter()
            .any(|source| source.conversation_id.as_deref() == Some("ses_1")),
        "the deleted conversation's source link must be gone"
    );
    assert!(repo
        .list(&MemoryQuery {
            statuses: Some(vec![MemoryStatus::Active, MemoryStatus::Superseded]),
            ..MemoryQuery::default()
        })
        .expect("list")
        .iter()
        .all(|record| record.memory.id != derived.id));
}

#[test]
fn task_links_are_a_relation_not_a_second_task_store() {
    let repo = repo();
    let mut event = global_preference("周五有答辩", None);
    event.memory_type = MemoryType::Event;
    let memory = repo.create(&event).expect("create");

    repo.link_task(&memory.id, "task-1").expect("link");
    // Linking twice is idempotent.
    repo.link_task(&memory.id, "task-1").expect("link again");
    let records = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(records[0].linked_task_ids, vec!["task-1".to_owned()]);

    // A deleted task drops the link, never the memory.
    assert_eq!(repo.unlink_task_everywhere("task-1").expect("unlink"), 1);
    let after = repo.list(&MemoryQuery::default()).expect("list");
    assert_eq!(after.len(), 1);
    assert!(after[0].linked_task_ids.is_empty());

    // Forgetting the memory drops the link, and the task id survives elsewhere.
    repo.link_task(&memory.id, "task-2").expect("relink");
    repo.forget(&memory.id).expect("forget");
    repo.store()
        .with_connection(|connection| {
            let links: i64 = connection
                .query_row("SELECT COUNT(*) FROM memory_task_links", [], |row| row.get(0))
                .expect("count");
            assert_eq!(links, 0);
            Ok(())
        })
        .expect("inspect");
}

#[test]
fn linking_an_unknown_memory_reports_not_found() {
    let repo = repo();
    assert_eq!(
        repo.link_task("nope", "task-1").expect_err("missing").code(),
        MemoryErrorCode::NotFound
    );
}

#[test]
fn relationship_state_is_per_persona_and_revision_checked() {
    let repo = repo();
    let initial = repo.relationship("aimisi").expect("create");
    assert_eq!(initial.familiarity, 0);
    assert_eq!(initial.summary, "");
    assert_eq!(initial.revision, 1);

    let updated = repo
        .set_relationship_summary("aimisi", "一起讨论过答辩准备。", initial.revision)
        .expect("update");
    assert_eq!(updated.revision, 2);

    assert_eq!(
        repo.set_relationship_summary("aimisi", "覆盖", initial.revision)
            .expect_err("stale")
            .code(),
        MemoryErrorCode::Conflict
    );

    // Another persona is untouched.
    let other = repo.relationship("changli").expect("other");
    assert_eq!(other.summary, "");
}

#[test]
fn relationship_summaries_stay_bounded_and_non_sensitive() {
    let repo = repo();
    let state = repo.relationship("aimisi").expect("state");
    assert_eq!(
        repo.set_relationship_summary("aimisi", &"字".repeat(401), state.revision)
            .expect_err("too long")
            .code(),
        MemoryErrorCode::ValidationFailed
    );
    assert_eq!(
        repo.set_relationship_summary("aimisi", "知道对方月薪两万三", state.revision)
            .expect_err("sensitive")
            .code(),
        MemoryErrorCode::ValidationFailed
    );
}

#[test]
fn listing_respects_the_limit_and_orders_by_importance() {
    let repo = repo();
    for index in 0..5 {
        let mut request = global_preference(&format!("偏好 {index}"), None);
        request.importance = Some((index % 5) + 1);
        repo.create(&request).expect("create");
    }
    let limited = repo
        .list(&MemoryQuery {
            limit: Some(2),
            ..MemoryQuery::default()
        })
        .expect("list");
    assert_eq!(limited.len(), 2);
    assert!(limited[0].memory.importance >= limited[1].memory.importance);
}

#[test]
fn a_listing_stays_capped_even_when_the_caller_asks_for_everything() {
    let repo = repo();
    // Past the listing cap: a window must not be able to pull the whole
    // database into memory at once, however large a limit it requests.
    const TOTAL: usize = 540;
    for index in 0..TOTAL {
        repo.create(&global_preference(
            &format!("偏好 {index}"),
            Some(&format!("pref.{index}")),
        ))
        .expect("create");
    }

    let capped = repo
        .list(&MemoryQuery {
            limit: Some(i64::MAX),
            ..MemoryQuery::default()
        })
        .expect("list");
    assert!(
        capped.len() < TOTAL,
        "listing returned all {TOTAL} rows; the UI cap is gone"
    );

    // The export path is the one place that must return everything.
    let complete = repo
        .export_records(&MemoryQuery::default())
        .expect("export records");
    assert_eq!(complete.len(), TOTAL);
}

// Test-only clock control.
impl MemoryRepository<FixedClock> {
    fn clock_advance(&self, hours: i64) {
        self.clock().advance_hours(hours);
    }
}
