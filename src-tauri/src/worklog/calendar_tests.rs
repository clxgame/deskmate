use super::*;
use chrono::FixedOffset;

fn utc(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

#[test]
fn friday_due_and_monday_recovery_choose_one_latest_week() {
    let rule = CalendarRule::parse(&[5], "17:00", true).unwrap();
    let zone = FixedOffset::east_opt(8 * 3600).unwrap();
    let created = utc("2026-08-01T00:00:00Z");
    let friday = rule
        .latest_due((created, utc("2026-09-04T09:00:00Z")), &zone)
        .unwrap();
    let recovered = rule
        .latest_due((created, utc("2026-09-07T01:00:00Z")), &zone)
        .unwrap();
    assert_eq!(friday, recovered);
    assert_eq!(friday.period_start.to_string(), "2026-08-31");
    assert_eq!(friday.period_end.to_string(), "2026-09-04");
    assert_eq!(
        rule.next_due(friday.due_at, &zone).unwrap().due_at,
        utc("2026-09-11T09:00:00Z")
    );
}

#[test]
fn creation_boundary_and_clock_rollback_do_not_invent_past_occurrence() {
    let rule = CalendarRule::parse(&[5], "17:00", true).unwrap();
    let created = utc("2026-09-05T00:00:00Z");
    assert!(rule
        .latest_due((created, utc("2026-09-07T00:00:00Z")), &Utc)
        .is_none());
    assert!(rule
        .latest_due((created, utc("2026-09-04T00:00:00Z")), &Utc)
        .is_none());
}

#[test]
fn weekday_daily_skips_weekend_and_preserves_single_day_range() {
    let rule = CalendarRule::parse(&[1, 2, 3, 4, 5], "18:00", false).unwrap();
    let next = rule.next_due(utc("2026-09-04T18:00:00Z"), &Utc).unwrap();
    assert_eq!(next.due_at, utc("2026-09-07T18:00:00Z"));
    assert_eq!(next.period_start, next.period_end);
    assert!(CalendarRule::parse(&[6], "18:00", false).is_err());
    assert!(CalendarRule::parse(&[5], "25:00", true).is_err());
}

#[test]
fn daylight_gap_advances_and_overlap_chooses_first_instant() {
    let local =
        chrono::NaiveDateTime::parse_from_str("2026-03-27 02:30", "%Y-%m-%d %H:%M").unwrap();
    let first = utc("2026-03-27T01:00:00Z");
    let resolved = resolve_local(local, |candidate| {
        if candidate.time() < NaiveTime::from_hms_opt(3, 0, 0).unwrap() {
            LocalResult::None
        } else {
            LocalResult::Single(first)
        }
    });
    assert_eq!(resolved, Some(first));
    assert_eq!(
        resolve_local(local, |_| LocalResult::Ambiguous(
            first + Duration::hours(1),
            first
        )),
        Some(first)
    );
    assert!(resolve_local(local, |_| LocalResult::None).is_none());
}

#[test]
fn business_date_switches_at_three_across_calendar_boundaries() {
    for (instant, expected) in [
        ("2026-09-11T02:59:59+08:00", "2026-09-10"),
        ("2026-09-11T03:00:00+08:00", "2026-09-11"),
        ("2026-01-01T00:00:00+08:00", "2025-12-31"),
        ("2024-03-01T01:00:00+08:00", "2024-02-29"),
        ("2026-09-11T02:59:59-05:00", "2026-09-10"),
    ] {
        let now = DateTime::parse_from_rfc3339(instant).expect("clock");
        assert_eq!(business_date(now.naive_local()).to_string(), expected);
    }
}

#[test]
fn early_schedule_keeps_wall_clock_but_reports_previous_workday() {
    let zone = FixedOffset::east_opt(8 * 3600).expect("zone");
    let monday = NaiveDate::from_ymd_opt(2026, 9, 14).expect("date");
    let daily = CalendarRule::parse(&[1], "02:00", false).expect("rule");
    let occurrence = daily.on_date(monday, &zone).expect("occurrence");
    assert_eq!(occurrence.due_at, utc("2026-09-13T18:00:00Z"));
    assert_eq!(occurrence.period_start.to_string(), "2026-09-13");
    let weekly = CalendarRule::parse(&[1], "02:00", true).expect("rule");
    let occurrence = weekly.on_date(monday, &zone).expect("occurrence");
    assert_eq!(occurrence.period_start.to_string(), "2026-09-07");
    assert_eq!(occurrence.period_end.to_string(), "2026-09-11");
}
