use super::super::contract::SourceRef;
use super::*;
fn material(text: &str) -> SourceSnapshot {
    SourceSnapshot {
        source: SourceRef {
            kind: "entry".into(),
            id: "a".into(),
            revision: 1,
        },
        business_date: "2026-09-07".into(),
        project: None,
        entry_status: None,
        text: text.into(),
    }
}
#[test]
fn rejects_unknown_missing_empty_and_truncated_output() {
    let sources = vec![material("完成联调")];
    for raw in [
        r#"{"blocks":[]}"#,
        r#"{"blocks":[{"heading":"成果","text":"完成","sources":["entry:unknown:1"]}]}"#,
        "{",
    ] {
        assert!(validate_output(raw, &sources).is_err());
    }
    assert!(validate_output(
        r#"{"blocks":[{"heading":"成果","text":"完成联调","sources":["entry:a:1"]}]}"#,
        &sources
    )
    .is_ok());
}
#[test]
fn input_is_chunked_without_truncation_and_empty_stays_empty() {
    assert!(chunks(&[]).unwrap().is_empty());
    let sources = vec![material(&"中".repeat(12000)), material(&"文".repeat(12000))];
    let batches = chunks(&sources).unwrap();
    assert_eq!(batches.len(), 2);
    assert!(batches
        .iter()
        .all(|batch| batch.input.chars().count() <= INPUT_LIMIT));
    assert_eq!(
        batches
            .iter()
            .map(|batch| batch.input.as_str())
            .collect::<String>()
            .matches('中')
            .count(),
        12000
    );
}
