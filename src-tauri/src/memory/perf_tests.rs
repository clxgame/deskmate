//! Performance and concurrency guarantees.
//!
//! These run as ordinary tests so a regression fails CI rather than needing a
//! separate benchmark run.

use std::sync::Arc;

use super::domain::{MemoryQuery, MemoryScope, MemoryStatus, MemoryType, NewMemory, SourceKind};
use super::repository::{MemoryRepository, SystemClock};
use super::retrieval::{context_for_turn, MAX_CONTEXT_CHARS, MAX_INJECTED_MEMORIES};
use super::storage::{MemoryStore, DB_FILE_NAME};

/// Retrieval must stay well inside a chat turn's latency budget.
const RETRIEVAL_P95_BUDGET_MS: u128 = 50;
const SYNTHETIC_MEMORIES: usize = 10_000;

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("deskmate-memory-{label}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn synthetic(index: usize) -> NewMemory {
    // A realistic mix: mostly persona-scoped chatter with global anchors mixed
    // in, so the query planner sees the same shape it will see in production.
    // `shared_moment` is persona-only by policy, so global rows never use it.
    let global = index.is_multiple_of(4);
    let memory_type = match index % 5 {
        0 => MemoryType::Preference,
        1 => MemoryType::Routine,
        2 => MemoryType::Goal,
        3 => MemoryType::Event,
        _ if global => MemoryType::Preference,
        _ => MemoryType::SharedMoment,
    };
    NewMemory {
        scope: if global {
            MemoryScope::Global
        } else {
            MemoryScope::Persona
        },
        persona_id: if global {
            None
        } else {
            Some(format!("persona{}", index % 20))
        },
        memory_type,
        memory_key: Some(format!("synthetic.{index}")),
        content: format!("第 {index} 条记忆：关于日程与偏好的一些细节说明"),
        importance: Some((index % 5 + 1) as i64),
        expires_at: None,
        source_kind: SourceKind::Explicit,
        conversation_id: Some(format!("ses_{}", index % 100)),
        message_id: Some(format!("msg_{index}")),
        sensitive_confirmed: false,
    }
}

#[test]
fn retrieval_stays_under_budget_with_ten_thousand_memories() {
    let dir = temp_dir("bench");
    let repository = MemoryRepository::new(
        MemoryStore::open(&dir.join(DB_FILE_NAME)).expect("store"),
        SystemClock,
    );

    // Seed in one transaction per batch so setup does not dominate the test.
    for index in 0..SYNTHETIC_MEMORIES {
        repository.create(&synthetic(index)).expect("seed");
    }

    let queries = [
        "帮我看看日程",
        "关于偏好的事",
        "第 4200 条记忆",
        "有什么目标",
        "今天怎么样",
    ];
    let mut samples: Vec<u128> = Vec::new();
    for round in 0..40 {
        let query = queries[round % queries.len()];
        let started = std::time::Instant::now();
        let context = context_for_turn(&repository, "persona7", query, true).expect("retrieval");
        samples.push(started.elapsed().as_millis());

        assert!(context.memories.len() <= MAX_INJECTED_MEMORIES);
        let injected: usize = context
            .memories
            .iter()
            .map(|memory| memory.content.chars().count())
            .sum();
        assert!(
            injected <= MAX_CONTEXT_CHARS,
            "{injected} characters injected"
        );
    }

    samples.sort_unstable();
    let p95 = samples[(samples.len() * 95).div_ceil(100).min(samples.len()) - 1];
    println!(
        "retrieval over {SYNTHETIC_MEMORIES} memories: p50={}ms p95={p95}ms max={}ms",
        samples[samples.len() / 2],
        samples[samples.len() - 1]
    );
    assert!(
        p95 <= RETRIEVAL_P95_BUDGET_MS,
        "retrieval p95 was {p95}ms over {SYNTHETIC_MEMORIES} memories (budget {RETRIEVAL_P95_BUDGET_MS}ms); samples: {samples:?}"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn concurrent_writers_from_several_windows_never_lose_a_write() {
    let dir = temp_dir("concurrent");
    let repository = Arc::new(MemoryRepository::new(
        MemoryStore::open(&dir.join(DB_FILE_NAME)).expect("store"),
        SystemClock,
    ));

    // Three windows (pet, chat, settings) writing at the same time.
    const WRITERS: usize = 3;
    const PER_WRITER: usize = 40;
    let handles: Vec<_> = (0..WRITERS)
        .map(|writer| {
            let repository = Arc::clone(&repository);
            std::thread::spawn(move || {
                for index in 0..PER_WRITER {
                    repository
                        .create(&synthetic(writer * 1_000 + index))
                        .expect("concurrent create");
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("writer thread");
    }

    let stored = repository
        .list(&MemoryQuery {
            statuses: Some(vec![
                MemoryStatus::Active,
                MemoryStatus::Superseded,
                MemoryStatus::Expired,
            ]),
            limit: Some(i64::MAX),
            ..MemoryQuery::default()
        })
        .expect("list");
    assert_eq!(
        stored.len(),
        WRITERS * PER_WRITER,
        "a concurrent write was lost"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_concurrent_reader_never_sees_a_partial_write() {
    let dir = temp_dir("reader");
    let repository = Arc::new(MemoryRepository::new(
        MemoryStore::open(&dir.join(DB_FILE_NAME)).expect("store"),
        SystemClock,
    ));

    let writer = {
        let repository = Arc::clone(&repository);
        std::thread::spawn(move || {
            for index in 0..60 {
                repository.create(&synthetic(index)).expect("create");
            }
        })
    };
    let reader = {
        let repository = Arc::clone(&repository);
        std::thread::spawn(move || {
            for _ in 0..60 {
                let records = repository.list(&MemoryQuery::default()).expect("list");
                for record in records {
                    // Every visible row is complete: content present, and the
                    // scope invariant holds.
                    assert!(!record.memory.content.is_empty());
                    match record.memory.scope {
                        MemoryScope::Global => {
                            assert!(record.memory.persona_id.is_none())
                        }
                        MemoryScope::Persona => {
                            assert!(record.memory.persona_id.is_some())
                        }
                    }
                }
            }
        })
    };
    writer.join().expect("writer");
    reader.join().expect("reader");

    std::fs::remove_dir_all(&dir).ok();
}
