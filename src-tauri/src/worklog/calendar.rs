use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveTime, TimeZone, Timelike, Utc,
};

pub fn business_date(local: chrono::NaiveDateTime) -> NaiveDate {
    let date = local.date();
    if local.hour() < 3 {
        date.pred_opt().unwrap_or(date)
    } else {
        date
    }
}

#[derive(Debug, Clone)]
pub struct CalendarRule {
    pub weekdays: Vec<u32>,
    pub time: NaiveTime,
    pub weekly: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    pub due_at: DateTime<Utc>,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
}

impl CalendarRule {
    pub fn parse(weekdays: &[u32], time: &str, weekly: bool) -> Result<Self, &'static str> {
        if weekdays.is_empty() || weekdays.iter().any(|day| !(1..=5).contains(day)) {
            return Err("weekdays must contain Monday through Friday");
        }
        if weekly && weekdays.len() != 1 {
            return Err("weekly schedule requires one weekday");
        }
        let time = NaiveTime::parse_from_str(time, "%H:%M").map_err(|_| "invalid HH:MM")?;
        Ok(Self {
            weekdays: weekdays.to_vec(),
            time,
            weekly,
        })
    }

    pub fn on_date<T: TimeZone>(&self, date: NaiveDate, zone: &T) -> Option<Occurrence> {
        if !self.weekdays.contains(&date.weekday().number_from_monday()) {
            return None;
        }
        let due_at = resolve_local(date.and_time(self.time), |local| {
            zone.from_local_datetime(local)
                .map(|value| value.with_timezone(&Utc))
        })?;
        let date = business_date(due_at.with_timezone(zone).naive_local());
        let (period_start, period_end) = if self.weekly {
            let monday = date.checked_sub_signed(Duration::days(i64::from(
                date.weekday().num_days_from_monday(),
            )))?;
            (monday, monday.checked_add_signed(Duration::days(4))?)
        } else {
            (date, date)
        };
        Some(Occurrence {
            due_at,
            period_start,
            period_end,
        })
    }

    pub fn latest_due<T: TimeZone>(
        &self,
        window: (DateTime<Utc>, DateTime<Utc>),
        zone: &T,
    ) -> Option<Occurrence> {
        let (created_at, now) = window;
        let today = now.with_timezone(zone).date_naive();
        (0..8).find_map(|offset| {
            let date = today.checked_sub_signed(Duration::days(offset))?;
            self.on_date(date, zone)
                .filter(|item| item.due_at >= created_at && item.due_at <= now)
        })
    }

    pub fn next_due<T: TimeZone>(&self, after: DateTime<Utc>, zone: &T) -> Option<Occurrence> {
        let today = after.with_timezone(zone).date_naive();
        (0..8).find_map(|offset| {
            let date = today.checked_add_signed(Duration::days(offset))?;
            self.on_date(date, zone).filter(|item| item.due_at > after)
        })
    }
}

#[cfg(test)]
#[path = "calendar_tests.rs"]
mod tests;

fn resolve_local(
    mut local: chrono::NaiveDateTime,
    resolve: impl Fn(&chrono::NaiveDateTime) -> LocalResult<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    let date = local.date();
    loop {
        match resolve(&local) {
            LocalResult::Single(value) => return Some(value),
            LocalResult::Ambiguous(first, second) => return Some(first.min(second)),
            LocalResult::None => {
                local = local.checked_add_signed(Duration::minutes(1))?;
                if local.date() != date {
                    return None;
                }
            }
        }
    }
}
