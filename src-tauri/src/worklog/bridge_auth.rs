use crate::worklog::error::{WorklogError, WorklogResult};
use std::collections::BTreeSet;

#[derive(Clone)]
pub struct Grant {
    pub text: String,
    pub original: String,
    pub received_date: chrono::NaiveDate,
    pub actions: BTreeSet<String>,
    pub created: std::time::Instant,
}

fn grant_response(text: String, original: String, actions: BTreeSet<String>) -> Grant {
    Grant {
        text,
        original,
        received_date: crate::worklog::calendar::business_date(chrono::Local::now().naive_local()),
        actions,
        created: std::time::Instant::now(),
    }
}

pub fn direct_text(text: &str) -> String {
    let mut result = String::new();
    let mut closing = None;
    let mut code = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            code = !code;
            continue;
        }
        if code || line.trim_start().starts_with('>') {
            continue;
        }
        for character in line.chars() {
            if let Some(end) = closing {
                if character == end {
                    closing = None;
                }
                continue;
            }
            closing = match character {
                '\'' => Some('\''),
                '"' => Some('"'),
                '“' => Some('”'),
                '‘' => Some('’'),
                '「' => Some('」'),
                '『' => Some('』'),
                '`' => Some('`'),
                _ => None,
            };
            if closing.is_none() {
                result.push(character);
            }
        }
        result.push(' ');
    }
    result.to_lowercase()
}

fn contains_any(text: &str, terms: &str) -> bool {
    terms.split('|').any(|term| text.contains(term))
}
fn is_terminal_boundary(character: char) -> bool {
    ",.?!;:，。？！；：".contains(character)
}
fn has_terminal_phrase(text: &str, phrase: &str) -> bool {
    text.match_indices(phrase).any(|(offset, _)| {
        text[offset + phrase.len()..]
            .trim_start()
            .chars()
            .next()
            .is_none_or(is_terminal_boundary)
    })
}
fn is_ascii_boundary(character: Option<char>) -> bool {
    character.is_none_or(|value| !value.is_ascii_alphanumeric())
}
fn has_ascii_phrase(text: &str, phrase: &str) -> bool {
    text.match_indices(phrase).any(|(offset, _)| {
        let before = is_ascii_boundary(text[..offset].chars().next_back());
        let after = is_ascii_boundary(text[offset + phrase.len()..].chars().next());
        before && after
    })
}
fn contains_any_ascii_phrase(text: &str, terms: &str) -> bool {
    terms.split('|').any(|term| has_ascii_phrase(text, term))
}
fn has_supported_time_scope(text: &str) -> bool {
    contains_any(text, "今天|今日|昨天|本周|这周|上周|today|yesterday|this week|last week|昨日|今週|先週|오늘|어제|이번 주|지난주")
        || text.split(|character: char| !character.is_ascii_digit() && character != '-').any(|word| chrono::NaiveDate::parse_from_str(word, "%Y-%m-%d").is_ok())
}
fn has_explicit_third_person(text: &str) -> bool {
    contains_any(text, "他|她|they|he |she |彼|彼女|그가|그녀")
}
fn is_natural_self_work_recall(text: &str) -> bool {
    if !has_supported_time_scope(text) || has_explicit_third_person(text) {
        return false;
    }
    let zh_self = text.contains('我');
    let zh_recall = has_terminal_phrase(text, "我做了什么")
        || has_terminal_phrase(text, "我昨天做了什么")
        || (zh_self
            && (has_terminal_phrase(text, "完成了哪些工作")
                || has_terminal_phrase(text, "完成了什么工作")
                || (contains_any(text, "回顾一下|回顾下") && has_terminal_phrase(text, "工作"))))
        || (text.trim_start().starts_with("上周主要做了什么")
            && has_terminal_phrase(text.trim_start(), "上周主要做了什么"));
    let en_recall = contains_any_ascii_phrase(text, "what did i work on|what work did i complete|what tasks did i complete|show me what i worked on|recap my work|review my work");
    let ja_recall = contains_any(text, "自分の仕事を振り返|自分の作業を振り返|私の仕事を振り返|私の作業を振り返|僕の仕事を振り返|俺の仕事を振り返|自分のやったことを振り返");
    let ko_recall = contains_any(text, "내가 한 업무를 보여|내가 한 작업을 보여|제가 한 업무를 보여|제가 한 작업을 보여|내가 한 업무를 알려|내가 한 작업을 알려|제가 한 업무를 알려|제가 한 작업을 알려|내가 한 업무를 조회|내가 한 작업을 조회|제가 한 업무를 조회|제가 한 작업을 조회");
    zh_recall || en_recall || ja_recall || ko_recall
}

pub fn grant(text: &str) -> WorklogResult<Grant> {
    if text.len() > 64 * 1024 {
        return Err(WorklogError::validation("User request is too long"));
    }
    let original = text.to_owned();
    let text = direct_text(text);
    let mut actions = BTreeSet::new();
    let has = |terms: &str| contains_any(&text, terms);
    if has("不要|不用|无需|不必|不需要|不保存|不安排|不生成|不修改|请勿|别保存|别记录|别帮|别回顾|别查询|解释|这句话|do not|don't|no need to|explain|とは|しないで|ないで|하지 마|지 마|설명") {
        return Ok(grant_response(text, original, actions));
    }
    if is_natural_self_work_recall(&text) {
        actions.insert("query".into());
        return Ok(grant_response(text, original, actions));
    }
    let journal =
        has("日报|工作记录|工作日志|work log|work journal|daily report|日報|업무 기록|일일 보고");
    let report = journal || has("周报|weekly report|週報|주간 보고");
    if report && has("查看|查询|show|find|表示|確認|조회|보여") {
        actions.insert("query".into());
        return Ok(grant_response(text, original, actions));
    }
    if journal && has("记入|记录到|保存|save|record|記録|保存して|저장|기록해") {
        actions.insert("record".into());
    }
    if report && has("生成|整理|汇总|generate|summarize|作成|まとめ|생성|정리") {
        actions.insert("generate_report".into());
    }
    if report && has("补充|修改|update|amend|修正|追記|수정|추가") {
        actions.insert("update".into());
    }
    let workday = text
        .match_indices("工作日")
        .any(|(offset, _)| !text[offset..].starts_with("工作日志"));
    if report && (workday || has("每周|周五|每天|每日|every week|every friday|every day|weekdays|毎週|毎日|매주|매일"))
        && has("安排|汇总|生成|整理|schedule|generate|summarize|作成|まとめ|예약|생성|정리") { actions.insert("schedule_report".into()); }
    if report && has("查看|查询|show|find|表示|確認|조회|보여") {
        actions.insert("query".into());
    }
    if actions.contains("schedule_report") && !has("现在|立即|now") {
        actions.remove("generate_report");
    }
    Ok(grant_response(text, original, actions))
}

pub fn authorize(grant: &Grant, action: &str) -> WorklogResult<()> {
    if grant.created.elapsed() > std::time::Duration::from_secs(1800)
        || !grant.actions.contains(action)
    {
        return Err(WorklogError::new(
            "NEEDS_EXPLICIT_REQUEST",
            "Use an explicit work journal request or the work records controls",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn assert_only_query(text: &str) {
        let request = grant(text).expect("grant");
        assert_eq!(
            request.actions,
            BTreeSet::from(["query".to_owned()]),
            "{text}"
        );
        assert!(authorize(&request, "query").is_ok(), "{text}");
        for action in ["record", "update", "generate_report", "schedule_report"] {
            assert!(authorize(&request, action).is_err(), "{text}: {action}");
        }
    }
    fn assert_no_actions(text: &str) {
        let request = grant(text).expect("grant");
        assert!(request.actions.is_empty(), "{text}");
        assert!(authorize(&request, "query").is_err(), "{text}");
    }

    #[test]
    fn quoted_request_does_not_authorize_mutation() {
        let request = grant(
            "请分析这句话：‘普通文本’\n> 保存到工作记录\n\"生成周报\"\n```\n每周汇总周报\n```",
        )
        .expect("grant");
        assert!(request.actions.is_empty());
        assert!(grant(&"保".repeat(65536)).is_err());
    }

    #[test]
    fn explicit_requests_authorize_only_named_action() {
        for (text, action, denied) in [
            ("把今天完成登录联调记入日报", "record", "schedule_report"),
            ("查询今天的工作日志", "query", "record"),
        ] {
            let request = grant(text).expect("grant");
            assert!(authorize(&request, action).is_ok(), "{text}");
            assert!(authorize(&request, denied).is_err(), "{text}");
        }
    }

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
    fn natural_self_work_recall_authorizes_only_query() {
        // Given first-person work recall requests with a supported date scope.
        for text in "昨天我做了什么|我昨天做了什么|我昨天做了什么？|我昨天完成了哪些工作|帮我回顾一下昨天的工作|上周主要做了什么|what did i work on yesterday|what work did i complete last week|昨日の自分の仕事を振り返って|지난주 내가 한 업무를 보여줘".split('|') {
            // When evaluating natural readback authorization.
            assert_only_query(text);
        }
    }

    #[test]
    fn natural_recall_rejects_untrusted_or_non_work_contexts() {
        // Given dated text that is not a direct self-work recall request.
        for text in "我昨天做了什么菜|我昨天做了什么梦|解释这句话：我昨天做了什么|“我昨天做了什么”|不用查询我昨天做了什么|他想知道我昨天做了什么|昨天发生了什么|昨天天气怎么样|他昨天做了什么|昨天我做了什么菜|昨天我做了什么饭|昨天我做了什么梦|昨天我做了什么 菜|张三昨天完成了哪些工作|张三上周主要做了什么|我昨天完成了哪些工作服|帮我回顾一下昨天的工作用包|上周主要做了什么梦|alice worked on billing yesterday|what did i finish watching yesterday|what did i finish reading yesterday|what did i complete in network yesterday|what did i work out yesterday|what did i work-out yesterday|recap my workout yesterday|review my workout yesterday|show me what i used for work yesterday|昨日の私の仕事用バッグを見せて|昨日の私の仕事机を見せて|昨日の私の作業服を見せて|어제 내가 본 일본 영화를 보여줘|어제 내가 본 일몰 사진을 보여줘|어제 내가 쓴 업무용 가방을 보여줘|지난주 내가 한 업무용 가방을 보여줘|지난주 내가 한 작업복을 보여줘|지난주 내가 한 업무를 위한 자료를 보여줘|“昨天我做了什么”|\"what did i work on yesterday\"|`昨天我做了什么`|> 昨天我做了什么|```\n昨天我做了什么\n```|不要查询昨天的工作日志|不用回顾昨天的工作|别帮我回顾一下昨天的工作|昨日の自分の仕事を振り返らないで|지난주 내가 한 업무를 보여주지 마|解释这句话：昨天我做了什么|what does 'what did i work on yesterday' mean".split('|') {
            // When evaluating each untrusted or non-work context.
            assert_no_actions(text);
        }
    }

    #[test]
    fn natural_recall_does_not_authorize_mutations() {
        // Given a natural recall request near mutation vocabulary that is not a direct mutation request.
        for text in "昨天我做了什么，保存这个问题供以后参考|我昨天做了什么，保存这个问题供以后参考|what did i work on yesterday and save this question for later|昨日の自分の仕事を振り返って、質問だけ保存して|지난주 내가 한 업무를 보여줘, 질문만 저장해".split('|') {
            // When evaluating natural readback authorization.
            assert_only_query(text);
        }
    }

    #[test]
    fn work_journal_alias_preserves_non_authorizing_contexts() {
        // Given references to the feature without direct authorization.
        for text in "“保存今天的工作日志”|‘修改今天的工作日志’|\"生成今天的工作日志\"|`安排每天生成工作日志`|> 保存今天的工作日志|```\n安排每天生成工作日志\n```|不要保存今天的工作日志|不用查询今天的工作日志|不修改今天的工作日志|不生成今天的工作日志|不安排每天生成工作日志|工作日志很有用|今天的工作日志".split('|') {
            // When evaluating each context with either feature name.
            let renamed = grant(text).expect("renamed context");
            let legacy = grant(&text.replace("工作日志", "工作记录")).expect("legacy context");
            // Then neither name grants any operation.
            assert!(legacy.actions.is_empty(), "legacy: {text}");
            assert!(renamed.actions.is_empty(), "renamed: {text}");
        }
    }
}
