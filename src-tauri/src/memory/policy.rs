//! Policy: the only place that decides what may be stored.
//!
//! The extractor and the frontend both merely propose. Everything below runs in
//! Rust so no caller, flag, or model output can bypass it.

use super::domain::{
    MemoryScope, MemoryType, NewMemory, Sensitivity, MAX_CONTENT_CHARS, MAX_KEY_CHARS,
};
use super::error::{MemoryError, MemoryResult};

/// Longest a transient mood may live in working context.
pub const MOOD_TTL_HOURS: i64 = 12;
/// Importance used when a caller does not state one.
pub const DEFAULT_IMPORTANCE: i64 = 3;

/// Credential markers. Content matching any of these is rejected outright: it
/// is never stored, exported, logged, embedded, or sent to an extractor.
const SECRET_MARKERS: &[&str] = &[
    "password",
    "passwd",
    "api key",
    "apikey",
    "api-key",
    "api_key",
    "secret key",
    "secret_key",
    "access token",
    "access_token",
    "refresh token",
    "refresh_token",
    "bearer ",
    "private key",
    "private_key",
    "begin rsa",
    "begin openssh",
    "begin pgp",
    "recovery code",
    "seed phrase",
    "mnemonic",
    "cvv",
    "credential",
    "密码",
    "口令",
    "密钥",
    "私钥",
    "验证码",
    "助记词",
    "恢复码",
    "身份证号",
    "银行卡号",
    "信用卡",
];

/// High-entropy credential shapes that carry no keyword at all.
const SECRET_PREFIXES: &[&str] = &[
    "sk-",
    "ghp_",
    "gho_",
    "github_pat_",
    "xoxb-",
    "xoxp-",
    "AKIA",
];

/// Categories that may be stored only after an explicit confirmation.
const SENSITIVE_MARKERS: &[&str] = &[
    "抑郁",
    "焦虑症",
    "确诊",
    "病历",
    "手术",
    "吃药",
    "服药",
    "医院",
    "体检",
    "工资",
    "薪水",
    "月薪",
    "年薪",
    "存款",
    "负债",
    "贷款",
    "房贷",
    "破产",
    "住址",
    "家庭地址",
    "门牌",
    "小区",
    "身份证",
    "护照",
    "分手",
    "离婚",
    "出轨",
    "暗恋",
    "怀孕",
    "裁员",
    "被裁",
    "离职谈判",
    "公司机密",
    "未公开",
    "diagnosis",
    "depression",
    "anxiety disorder",
    "prescription",
    "salary",
    "mortgage",
    "debt",
    "home address",
    "passport",
    "divorce",
    "pregnant",
    "layoff",
    "confidential",
];

/// Model-inferred labels the companion must never store on its own.
const FORBIDDEN_INFERENCE_MARKERS: &[&str] = &[
    "看起来像是",
    "我判断用户",
    "推测用户",
    "疑似",
    "人格类型",
    "政治立场",
    "宗教信仰",
    "心理疾病",
    "personality type",
    "seems mentally",
    "probably has",
    "political stance",
];

/// Classify content into a privacy class. Case-insensitive; Chinese markers are
/// matched as-is.
pub fn classify(content: &str) -> Sensitivity {
    let lower = content.to_lowercase();
    if SECRET_MARKERS.iter().any(|marker| lower.contains(marker))
        || SECRET_PREFIXES
            .iter()
            .any(|prefix| content.contains(prefix))
        || looks_like_payment_card(content)
    {
        return Sensitivity::Secret;
    }
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return Sensitivity::Sensitive;
    }
    Sensitivity::Normal
}

/// A 13-19 digit run (ignoring spaces and dashes) that passes the Luhn check.
fn looks_like_payment_card(content: &str) -> bool {
    let digits: Vec<u32> = content
        .chars()
        .filter(|character| character.is_ascii_digit())
        .filter_map(|character| character.to_digit(10))
        .collect();
    if !(13..=19).contains(&digits.len()) {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(index, digit)| {
            if index % 2 == 1 {
                let doubled = digit * 2;
                if doubled > 9 {
                    doubled - 9
                } else {
                    doubled
                }
            } else {
                *digit
            }
        })
        .sum();
    sum.is_multiple_of(10)
}

/// Reject content the companion is not allowed to conclude by itself.
pub fn rejects_inferred_label(content: &str) -> bool {
    let lower = content.to_lowercase();
    FORBIDDEN_INFERENCE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

/// A create request that has passed policy, with the class Rust decided.
#[derive(Debug, Clone, PartialEq)]
pub struct AcceptedMemory {
    pub scope: MemoryScope,
    pub persona_id: Option<String>,
    pub memory_type: MemoryType,
    pub memory_key: Option<String>,
    pub content: String,
    pub sensitivity: Sensitivity,
    pub importance: i64,
    pub expires_at: Option<String>,
}

/// Validate and classify a create request.
///
/// `now_plus_mood_ttl` supplies the mood expiry so callers stay testable
/// without a clock.
pub fn accept_new(request: &NewMemory, now_plus_mood_ttl: &str) -> MemoryResult<AcceptedMemory> {
    let content = request.content.trim();
    let char_count = content.chars().count();
    if char_count == 0 {
        return Err(MemoryError::validation_failed("empty content"));
    }
    if char_count > MAX_CONTENT_CHARS {
        return Err(MemoryError::validation_failed("content too long"));
    }
    if rejects_inferred_label(content) {
        return Err(MemoryError::validation_failed(
            "inferred personal labels are not storable",
        ));
    }

    let sensitivity = classify(content);
    match sensitivity {
        Sensitivity::Secret => {
            // Deliberately no echo of the offending text.
            return Err(MemoryError::secret_rejected(
                "credential-like content is never stored",
            ));
        }
        Sensitivity::Sensitive if !request.sensitive_confirmed => {
            return Err(MemoryError::sensitive_confirmation_required(
                "sensitive content needs explicit confirmation",
            ));
        }
        _ => {}
    }

    let persona_id = match request.scope {
        MemoryScope::Global => {
            if request.memory_type.requires_persona_scope() {
                return Err(MemoryError::validation_failed(
                    "this memory type is persona-scoped",
                ));
            }
            None
        }
        MemoryScope::Persona => {
            let persona = request
                .persona_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    MemoryError::validation_failed("persona scope requires a persona id")
                })?;
            Some(persona.to_owned())
        }
    };

    let memory_key = match request.memory_key.as_deref().map(str::trim) {
        Some("") => None,
        Some(key) if key.chars().count() > MAX_KEY_CHARS => {
            return Err(MemoryError::validation_failed("memory key too long"));
        }
        Some(key) => Some(key.to_owned()),
        None => None,
    };

    let importance = request.importance.unwrap_or(DEFAULT_IMPORTANCE);
    if !(1..=5).contains(&importance) {
        return Err(MemoryError::validation_failed("importance out of range"));
    }

    // A mood is working context: it always expires, and never outlives the TTL.
    let expires_at = if request.memory_type == MemoryType::Mood {
        Some(match request.expires_at.as_deref() {
            Some(requested) if requested < now_plus_mood_ttl => requested.to_owned(),
            _ => now_plus_mood_ttl.to_owned(),
        })
    } else {
        request.expires_at.clone()
    };

    Ok(AcceptedMemory {
        scope: request.scope,
        persona_id,
        memory_type: request.memory_type,
        memory_key,
        content: content.to_owned(),
        sensitivity,
        importance,
        expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::super::domain::SourceKind;
    use super::super::error::MemoryErrorCode;
    use super::*;

    const MOOD_LIMIT: &str = "2026-01-01T12:00:00Z";

    fn request(content: &str) -> NewMemory {
        NewMemory {
            scope: MemoryScope::Global,
            persona_id: None,
            memory_type: MemoryType::Preference,
            memory_key: Some("food.sweets".into()),
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
    fn classifies_credentials_as_secret() {
        let cases = [
            "我的密码是 hunter2",
            "API key: sk-abcdef1234567890",
            "Bearer eyJhbGciOiJIUzI1NiJ9",
            "github_pat_11ABCDEF",
            "-----BEGIN RSA PRIVATE KEY-----",
            "恢复码 8842-2211",
            "银行卡号 4111 1111 1111 1111",
            "4111111111111111",
        ];
        for case in cases {
            assert_eq!(classify(case), Sensitivity::Secret, "not secret: {case}");
        }
    }

    #[test]
    fn classifies_private_life_as_sensitive() {
        let cases = [
            "我在吃抗抑郁的药",
            "月薪两万三",
            "家庭地址在城南",
            "上周和对象分手了",
            "my mortgage is 4000 a month",
            "this is company confidential",
        ];
        for case in cases {
            assert_eq!(
                classify(case),
                Sensitivity::Sensitive,
                "not sensitive: {case}"
            );
        }
    }

    #[test]
    fn classifies_ordinary_preferences_as_normal() {
        let cases = [
            "不喜欢甜食",
            "叫我小林",
            "每天七点起床",
            "prefers dark mode",
        ];
        for case in cases {
            assert_eq!(classify(case), Sensitivity::Normal, "not normal: {case}");
        }
    }

    #[test]
    fn a_plain_number_is_not_mistaken_for_a_card() {
        assert!(!looks_like_payment_card("我今年 28 岁"));
        assert!(!looks_like_payment_card("2026-01-01"));
        assert!(looks_like_payment_card("4111 1111 1111 1111"));
    }

    #[test]
    fn rejects_secrets_without_echoing_them() {
        let error = accept_new(&request("我的密码是 hunter2"), MOOD_LIMIT)
            .expect_err("secret must be rejected");
        assert_eq!(error.code(), MemoryErrorCode::SecretRejected);
        assert!(
            !error.message().contains("hunter2"),
            "error echoed the secret: {}",
            error.message()
        );
    }

    #[test]
    fn sensitive_content_needs_confirmation_then_stores() {
        let mut sensitive = request("月薪两万三");
        let error = accept_new(&sensitive, MOOD_LIMIT).expect_err("must require confirmation");
        assert_eq!(error.code(), MemoryErrorCode::SensitiveConfirmationRequired);

        sensitive.sensitive_confirmed = true;
        let accepted = accept_new(&sensitive, MOOD_LIMIT).expect("confirmed sensitive");
        assert_eq!(accepted.sensitivity, Sensitivity::Sensitive);
    }

    #[test]
    fn enforces_scope_invariants() {
        let mut shared = request("一起看了流星雨");
        shared.memory_type = MemoryType::SharedMoment;
        shared.scope = MemoryScope::Global;
        assert_eq!(
            accept_new(&shared, MOOD_LIMIT)
                .expect_err("shared moment cannot be global")
                .code(),
            MemoryErrorCode::ValidationFailed
        );

        shared.scope = MemoryScope::Persona;
        shared.persona_id = None;
        assert_eq!(
            accept_new(&shared, MOOD_LIMIT)
                .expect_err("persona scope needs an id")
                .code(),
            MemoryErrorCode::ValidationFailed
        );

        shared.persona_id = Some("  aimisi  ".into());
        let accepted = accept_new(&shared, MOOD_LIMIT).expect("valid persona memory");
        assert_eq!(accepted.persona_id.as_deref(), Some("aimisi"));
    }

    #[test]
    fn global_memories_drop_a_stray_persona_id() {
        let mut global = request("叫我小林");
        global.persona_id = Some("aimisi".into());
        let accepted = accept_new(&global, MOOD_LIMIT).expect("valid global memory");
        assert_eq!(accepted.persona_id, None);
    }

    #[test]
    fn bounds_content_key_and_importance() {
        assert_eq!(
            accept_new(&request("   "), MOOD_LIMIT)
                .expect_err("empty")
                .code(),
            MemoryErrorCode::ValidationFailed
        );
        let long = "字".repeat(MAX_CONTENT_CHARS + 1);
        assert_eq!(
            accept_new(&request(&long), MOOD_LIMIT)
                .expect_err("too long")
                .code(),
            MemoryErrorCode::ValidationFailed
        );

        let mut long_key = request("不喜欢甜食");
        long_key.memory_key = Some("k".repeat(MAX_KEY_CHARS + 1));
        assert_eq!(
            accept_new(&long_key, MOOD_LIMIT)
                .expect_err("key too long")
                .code(),
            MemoryErrorCode::ValidationFailed
        );

        let mut bad_importance = request("不喜欢甜食");
        bad_importance.importance = Some(9);
        assert_eq!(
            accept_new(&bad_importance, MOOD_LIMIT)
                .expect_err("importance")
                .code(),
            MemoryErrorCode::ValidationFailed
        );
    }

    #[test]
    fn moods_always_expire_within_the_ttl() {
        let mut mood = request("今天有点低落");
        mood.memory_type = MemoryType::Mood;
        mood.memory_key = None;
        let accepted = accept_new(&mood, MOOD_LIMIT).expect("mood");
        assert_eq!(accepted.expires_at.as_deref(), Some(MOOD_LIMIT));

        // A caller asking for a longer life is clamped back to the TTL.
        mood.expires_at = Some("2099-01-01T00:00:00Z".into());
        let clamped = accept_new(&mood, MOOD_LIMIT).expect("mood");
        assert_eq!(clamped.expires_at.as_deref(), Some(MOOD_LIMIT));

        // A shorter life is honored.
        mood.expires_at = Some("2026-01-01T06:00:00Z".into());
        let shorter = accept_new(&mood, MOOD_LIMIT).expect("mood");
        assert_eq!(shorter.expires_at.as_deref(), Some("2026-01-01T06:00:00Z"));
    }

    #[test]
    fn refuses_to_store_inferred_personal_labels() {
        let error = accept_new(&request("推测用户有心理疾病"), MOOD_LIMIT)
            .expect_err("inference must be refused");
        assert_eq!(error.code(), MemoryErrorCode::ValidationFailed);
    }
}
