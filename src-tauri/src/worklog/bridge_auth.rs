use std::collections::BTreeSet;
use crate::worklog::error::{WorklogError, WorklogResult};

#[derive(Clone)]
pub struct Grant { pub text: String, pub original: String, pub received_date: chrono::NaiveDate, pub actions: BTreeSet<String>, pub created: std::time::Instant }

pub fn direct_text(text: &str) -> String {
    let mut result = String::new();
    let mut closing = None;
    let mut code = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") { code = !code; continue; }
        if code || line.trim_start().starts_with('>') { continue; }
        for character in line.chars() {
            if let Some(end) = closing { if character == end { closing = None; } continue; }
            closing = match character { '\'' => Some('\''), '"' => Some('"'), '“' => Some('”'), '‘' => Some('’'), '「' => Some('」'), '『' => Some('』'), '`' => Some('`'), _ => None };
            if closing.is_none() { result.push(character); }
        }
        result.push(' ');
    }
    result.to_lowercase()
}

pub fn grant(text: &str) -> WorklogResult<Grant> {
    if text.len() > 64 * 1024 { return Err(WorklogError::validation("User request is too long")); }
    let original = text.to_owned();
    let text = direct_text(text);
    let mut actions = BTreeSet::new();
    let has = |terms: &[&str]| terms.iter().any(|term| text.contains(term));
    if has(&["不要", "不用", "无需", "不必", "不需要", "不保存", "不安排", "不生成", "不修改", "请勿", "别保存", "别记录", "解释", "这句话", "do not", "don't", "no need to", "explain", "とは", "しないで", "하지 마", "설명"]) {
        return Ok(Grant { text, original, received_date: chrono::Local::now().date_naive(), actions, created: std::time::Instant::now() });
    }
    let journal = has(&["日报", "工作记录", "工作日志", "work log", "work journal", "daily report", "日報", "업무 기록", "일일 보고"]);
    let report = journal || has(&["周报", "weekly report", "週報", "주간 보고"]);
    if report && has(&["查看", "查询", "show", "find", "表示", "確認", "조회", "보여"]) {
        actions.insert("query".into());
        return Ok(Grant { text, original, received_date: chrono::Local::now().date_naive(), actions, created: std::time::Instant::now() });
    }
    if journal && has(&["记入", "记录到", "保存", "save", "record", "記録", "保存して", "저장", "기록해"]) { actions.insert("record".into()); }
    if report && has(&["生成", "整理", "汇总", "generate", "summarize", "作成", "まとめ", "생성", "정리"]) { actions.insert("generate_report".into()); }
    if report && has(&["补充", "修改", "update", "amend", "修正", "追記", "수정", "추가"]) { actions.insert("update".into()); }
    let workday = text.match_indices("工作日").any(|(offset, _)| !text[offset..].starts_with("工作日志"));
    if report && (workday || has(&["每周", "周五", "每天", "每日", "every week", "every friday", "every day", "weekdays", "毎週", "毎日", "매주", "매일"]))
        && has(&["安排", "汇总", "生成", "整理", "schedule", "generate", "summarize", "作成", "まとめ", "예약", "생성", "정리"]) { actions.insert("schedule_report".into()); }
    if report && has(&["查看", "查询", "show", "find", "表示", "確認", "조회", "보여"]) { actions.insert("query".into()); }
    if actions.contains("schedule_report") && !has(&["现在","立即","now"]) { actions.remove("generate_report"); }
    Ok(Grant { text, original, received_date: chrono::Local::now().date_naive(), actions, created: std::time::Instant::now() })
}

pub fn authorize(grant: &Grant, action: &str) -> WorklogResult<()> {
    if grant.created.elapsed() > std::time::Duration::from_secs(1800) || !grant.actions.contains(action) {
        return Err(WorklogError::new("NEEDS_EXPLICIT_REQUEST", "Use an explicit work journal request or the work records controls"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoted_request_does_not_authorize_mutation() {
        let request = grant("请分析这句话：‘普通文本’\n> 保存到工作记录\n\"生成周报\"\n```\n每周汇总周报\n```").expect("grant");
        assert!(request.actions.is_empty());
    }
    #[test]
    fn explicit_request_authorizes_only_named_action() {
        let request = grant("把今天完成登录联调记入日报").expect("grant");
        assert!(authorize(&request, "record").is_ok());
        assert!(authorize(&request, "schedule_report").is_err());
    }
    #[test]
    fn long_request_is_rejected_without_truncation() { assert!(grant(&"保".repeat(65536)).is_err()); }

    #[test]
    fn work_journal_alias_grants_only_the_same_explicit_action() {
        // Given the renamed feature in each supported direct request.
        for (text, action) in [
            ("保存今天完成登录联调到工作日志", "record"),
            ("查询今天的工作日志", "query"),
            ("修改今天的工作日志", "update"),
            ("生成今天的工作日志", "generate_report"),
            ("生成本周的工作日志", "generate_report"),
            ("安排每天生成工作日志", "schedule_report"),
            ("安排每个工作日生成工作日志", "schedule_report"),
        ] {
            // When evaluating the new name and its existing compatible name.
            let renamed = grant(text).expect("renamed request");
            let legacy = grant(&text.replace("工作日志", "工作记录")).expect("legacy request");
            // Then both names authorize exactly the requested operation.
            let expected = BTreeSet::from([action.to_owned()]);
            assert_eq!(legacy.actions, expected, "legacy: {text}");
            assert_eq!(renamed.actions, expected, "renamed: {text}");
        }
    }

    #[test]
    fn work_journal_alias_preserves_non_authorizing_contexts() {
        // Given references to the feature without direct authorization.
        for text in [
            "“保存今天的工作日志”",
            "‘修改今天的工作日志’",
            "\"生成今天的工作日志\"",
            "`安排每天生成工作日志`",
            "> 保存今天的工作日志",
            "```\n安排每天生成工作日志\n```",
            "不要保存今天的工作日志",
            "不用查询今天的工作日志",
            "不修改今天的工作日志",
            "不生成今天的工作日志",
            "不安排每天生成工作日志",
            "工作日志很有用",
            "今天的工作日志",
        ] {
            // When evaluating each context with either feature name.
            let renamed = grant(text).expect("renamed context");
            let legacy = grant(&text.replace("工作日志", "工作记录")).expect("legacy context");
            // Then neither name grants any operation.
            assert!(legacy.actions.is_empty(), "legacy: {text}");
            assert!(renamed.actions.is_empty(), "renamed: {text}");
        }
    }
}
