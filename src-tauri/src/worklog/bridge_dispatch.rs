use super::{
    auth::{authorize, Grant},
    Request,
};
use crate::worklog::{
    contract::*,
    contract_runtime::*,
    error::{WorklogError, WorklogResult},
    repository::Repository,
};
use chrono::Datelike;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};

fn parse<T: DeserializeOwned>(value: Value) -> WorklogResult<T> {
    serde_json::from_value(value)
        .map_err(|_| WorklogError::validation("Invalid work journal arguments"))
}
fn scoped_date(grant: &Grant, date: &str) -> WorklogResult<()> {
    let today = grant.received_date.to_string();
    let yesterday = grant
        .received_date
        .pred_opt()
        .map(|value| value.to_string());
    let requested_yesterday = ["昨天", "yesterday", "昨日", "어제"]
        .iter()
        .any(|word| grant.text.contains(word));
    let has_explicit_date = grant
        .text
        .split(|character: char| !character.is_ascii_digit() && character != '-')
        .any(|word| chrono::NaiveDate::parse_from_str(word, "%Y-%m-%d").is_ok());
    let default_matches = !has_explicit_date
        && if requested_yesterday {
            yesterday.as_deref() == Some(date)
        } else {
            date == today
        };
    let week_offset = if ["上周", "last week", "先週", "지난주"]
        .iter()
        .any(|word| grant.text.contains(word))
    {
        Some(7)
    } else if ["本周", "这周", "this week", "今週", "이번 주"]
        .iter()
        .any(|word| grant.text.contains(word))
    {
        Some(0)
    } else {
        None
    };
    let week_matches = week_offset.is_some_and(|offset| {
        let monday = grant.received_date
            - chrono::Duration::days(
                i64::from(grant.received_date.weekday().num_days_from_monday()) + offset,
            );
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .is_ok_and(|date| date >= monday && date <= monday + chrono::Duration::days(6))
    });
    if !default_matches && !grant.text.contains(date) && !week_matches {
        return Err(WorklogError::new(
            "NEEDS_EXPLICIT_REQUEST",
            "Specify the report date explicitly",
        ));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Query {
    start: Option<String>,
    end: Option<String>,
    project: Option<String>,
    operation_id: Option<String>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum RecordMode {
    Direct,
    IfMissing,
}

pub fn execute(
    repo: &Repository,
    request: &Request,
    grant: &Grant,
    parent: &str,
    model: &str,
) -> WorklogResult<Value> {
    if request.action == "query" {
        authorize(grant, "query")?;
        let query: Query = parse(request.args.clone()).inspect_err(|_| {
            grant.query_failed.set(true);
            grant.last_query.replace(None);
        })?;
        if let Some(id) = query.operation_id {
            let operation = repo
                .operation(&id)
                .inspect_err(|_| grant.query_failed.set(true))?;
            return Ok(json!({"operation":operation}));
        }
        grant.query_failed.set(true);
        grant.last_query.replace(None);
        let start = query
            .start
            .ok_or_else(|| WorklogError::validation("start is required"))?;
        let end = query.end.unwrap_or_else(|| start.clone());
        let query = DateQuery {
            start,
            end,
            project: query.project,
        };
        let reports = repo
            .list_reports(&query)?
            .into_iter()
            .filter(|report| report.period_start >= query.start && report.period_end <= query.end)
            .map(|report| repo.get_report(&report.id))
            .collect::<WorklogResult<Vec<_>>>()?;
        let result = json!({"entries":repo.query_entries(&query)?,"reports":reports});
        if serde_json::to_vec(&json!({"version":1,"requestId":request.request_id,"status":"completed","result":result}))?.len() > 256 * 1024 {
            return Err(WorklogError::new("RESULT_TOO_LARGE", "Narrow the requested date range"));
        }
        grant.last_query.replace(Some(query));
        grant.query_failed.set(false);
        return Ok(result);
    }
    authorize(grant, &request.action)?;
    let mut args = request
        .args
        .as_object()
        .cloned()
        .ok_or_else(|| WorklogError::validation("Arguments must be an object"))?;
    for key in [
        "requestId",
        "sourceSessionId",
        "sourceMessageId",
        "originalText",
        "modelId",
    ] {
        if args.contains_key(key) {
            return Err(WorklogError::validation(
                "Host-owned identity or source field supplied",
            ));
        }
    }
    args.insert("requestId".into(), json!(request.request_id));
    let receipt = match request.action.as_str() {
        "record" => {
            let mode: RecordMode = parse(args.remove("mode").ok_or_else(|| {
                WorklogError::validation("record mode is required: direct or if_missing")
            })?)?;
            if grant.query_failed.get() {
                return Err(WorklogError::new("QUERY_REQUIRED", "The previous query failed; successfully query the work records again before writing"));
            }
            if args.contains_key("bodyMarkdown") {
                if mode == RecordMode::IfMissing {
                    return Err(WorklogError::validation("Conditional recording only adds missing tasks; do not overwrite a daily report"));
                }
                let report: SaveReport = parse(Value::Object(args))?;
                if report.kind != ReportKind::Daily {
                    return Err(WorklogError::validation("Direct archive is a daily report"));
                }
                if !grant.original.contains(&report.body_markdown) {
                    return Err(WorklogError::validation(
                        "Preserve the complete user supplied daily report text",
                    ));
                }
                return Ok(json!({"receipt":repo.save_report(&report)?}));
            }
            args.insert("sourceSessionId".into(), json!(request.session_id));
            args.insert("sourceMessageId".into(), json!(parent));
            args.insert("originalText".into(), json!(grant.original));
            let entry: RecordEntry = parse(Value::Object(args))?;
            if mode == RecordMode::IfMissing {
                if !grant.last_query.borrow().as_ref().is_some_and(|query| {
                    query.start <= entry.business_date
                        && query.end >= entry.business_date
                        && query.project.is_none()
                }) {
                    return Err(WorklogError::new("QUERY_REQUIRED", "Successfully query entries and reports for this date without a project filter before recording; a failed query is not an empty result"));
                }
                if repo
                    .operation(&entry.request_id)
                    .inspect_err(|_| grant.query_failed.set(true))?
                    .is_some()
                {
                    return Ok(json!({"receipt":repo.record_entry(&entry)?}));
                }
                let query = DateQuery {
                    start: entry.business_date.clone(),
                    end: entry.business_date.clone(),
                    project: None,
                };
                grant.query_failed.set(true);
                let entries = repo.query_entries(&query)?;
                let reports = repo
                    .list_reports(&query)?
                    .into_iter()
                    .filter(|report| report.kind == ReportKind::Daily)
                    .map(|report| repo.get_report(&report.id))
                    .collect::<WorklogResult<Vec<_>>>()?;
                grant.query_failed.set(false);
                if let Some(existing) = entries
                    .iter()
                    .find(|saved| saved.text.trim() == entry.text.trim())
                {
                    return Ok(json!({"alreadyRecorded":true,"entry":existing}));
                }
                if let Some(existing) = reports.iter().find(|detail| {
                    detail.versions.iter().any(|version| {
                        detail.report.current_version_id.as_deref() == Some(version.id.as_str())
                            && !entry.text.trim().is_empty()
                            && version.body_markdown.contains(entry.text.trim())
                    })
                }) {
                    return Ok(json!({"alreadyRecorded":true,"report":existing}));
                }
            }
            repo.record_entry(&entry)?
        }
        "update" => {
            if args.contains_key("bodyMarkdown") {
                let update: SaveReport = parse(Value::Object(args))?;
                scoped_date(grant, &update.period_start)?;
                scoped_date(grant, &update.period_end)?;
                if update.expected_revision.is_none() {
                    return Err(WorklogError::validation(
                        "Query the current report revision first",
                    ));
                }
                return Ok(json!({"receipt":repo.save_report(&update)?}));
            }
            let update: UpdateEntry = parse(Value::Object(args))?;
            scoped_date(grant, &update.business_date)?;
            let entries = repo.query_entries(&DateQuery {
                start: update.business_date.clone(),
                end: update.business_date.clone(),
                project: update.project.clone(),
            })?;
            if entries.len() != 1
                || entries.first().map(|entry| entry.id.as_str()) != Some(update.id.as_str())
            {
                return Err(WorklogError::new(
                    "NEEDS_EXPLICIT_REQUEST",
                    "Select one matching record in the work records controls",
                ));
            }
            repo.update_entry(&update)?
        }
        "generate_report" => {
            args.insert("modelId".into(), json!(model));
            let generate: GenerateReport = parse(Value::Object(args))?;
            scoped_date(grant, &generate.period_start)?;
            scoped_date(grant, &generate.period_end)?;
            repo.generate_report(&generate)?
        }
        "schedule_report" => {
            let explicit_time =
                grant.text.contains(':') || grant.text.contains('点') || grant.text.contains('時');
            let default_friday = !explicit_time
                && ["周五", "星期五"]
                    .iter()
                    .any(|word| grant.text.contains(word));
            if !args.contains_key("localTime") && default_friday {
                args.insert("localTime".into(), json!("17:00"));
            }
            let schedule = parse::<SaveSchedule>(Value::Object(args))?;
            let disclosed_default = default_friday
                && schedule.kind == ReportKind::Weekly
                && schedule.local_time == "17:00";
            if (!grant.text.contains(&schedule.local_time) && !disclosed_default)
                || schedule.id.is_some()
            {
                return Err(WorklogError::new(
                    "NEEDS_EXPLICIT_REQUEST",
                    "Specify the schedule time or use task controls to change an existing rule",
                ));
            }
            let weekday_words = [
                (1, ["周一", "星期一", "monday", "月曜", "월요일"]),
                (2, ["周二", "星期二", "tuesday", "火曜", "화요일"]),
                (3, ["周三", "星期三", "wednesday", "水曜", "수요일"]),
                (4, ["周四", "星期四", "thursday", "木曜", "목요일"]),
                (5, ["周五", "星期五", "friday", "金曜", "금요일"]),
                (6, ["周六", "星期六", "saturday", "土曜", "토요일"]),
                (7, ["周日", "星期日", "sunday", "日曜", "일요일"]),
            ];
            let mut requested: Vec<u32> = weekday_words
                .iter()
                .filter(|(_, words)| words.iter().any(|word| grant.text.contains(word)))
                .map(|(day, _)| *day)
                .collect();
            if ["工作日", "weekdays", "平日", "평일"]
                .iter()
                .any(|word| grant.text.contains(word))
            {
                requested = vec![1, 2, 3, 4, 5];
            }
            if ["每天", "每日", "every day", "毎日", "매일"]
                .iter()
                .any(|word| grant.text.contains(word))
            {
                requested = vec![1, 2, 3, 4, 5, 6, 7];
            }
            if requested.is_empty() || schedule.weekday_set != requested || !schedule.enabled {
                return Err(WorklogError::new(
                    "NEEDS_EXPLICIT_REQUEST",
                    "Confirm the weekdays in work records schedule controls",
                ));
            }
            let receipt = repo.save_schedule(&schedule)?;
            let saved = repo
                .list_schedules()?
                .into_iter()
                .find(|item| item.id == receipt.entity_id)
                .ok_or_else(WorklogError::missing)?;
            return Ok(json!({"receipt":receipt,"schedule":saved}));
        }
        _ => return Err(WorklogError::validation("Unknown work journal action")),
    };
    Ok(json!({"receipt":receipt}))
}

#[cfg(test)]
#[path = "bridge_dispatch_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "bridge_dispatch_query_tests.rs"]
mod query_tests;
