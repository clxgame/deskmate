use chrono::{Datelike, Local};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

const USAGE_PATH: &str = "/my-usage/api/detail";
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Deserialize)]
struct KuroUsageModel {
    model: Option<String>,
    requests: Option<u64>,
    cost_cny: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct KuroUsagePayload {
    period_limit_cny: Option<f64>,
    period_remaining_cny: Option<f64>,
    requests: Option<u64>,
    cost_cny: Option<f64>,
    #[serde(default)]
    models: Vec<KuroUsageModel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageModel {
    name: String,
    cost_cny: f64,
    requests: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    remaining_cny: f64,
    limit_cny: f64,
    remaining_pct: u8,
    days_until_reset: u8,
    today_cost_cny: f64,
    today_requests: u64,
    top_models: Vec<AiUsageModel>,
}

fn usage_url(base_url: &str, date: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim()).map_err(|_| "bad_url".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("bad_url".to_string());
    }
    let normalized_path = url.path().trim_end_matches('/');
    let gateway_path = normalized_path
        .strip_suffix("/v1")
        .unwrap_or(normalized_path);
    url.set_path(&format!("{gateway_path}{USAGE_PATH}"));
    url.set_query(Some(&format!("date={date}")));
    Ok(url)
}

fn days_until_next_monday() -> u8 {
    let elapsed = Local::now().weekday().num_days_from_monday();
    (7 - elapsed) as u8
}

fn short_model_name(model: &str) -> &str {
    model.rsplit('/').next().unwrap_or(model)
}

fn parse_usage_payload(
    payload: serde_json::Value,
    days_until_reset: u8,
) -> Result<AiUsage, String> {
    let payload: KuroUsagePayload =
        serde_json::from_value(payload).map_err(|_| "invalid_response".to_string())?;
    let Some(limit_cny) = payload.period_limit_cny.filter(|value| value.is_finite()) else {
        return Err("invalid_response".to_string());
    };
    let Some(remaining_cny) = payload
        .period_remaining_cny
        .filter(|value| value.is_finite())
    else {
        return Err("invalid_response".to_string());
    };
    if limit_cny < 0.0 || remaining_cny < 0.0 {
        return Err("invalid_response".to_string());
    }

    let remaining_pct = if limit_cny > 0.0 {
        ((remaining_cny / limit_cny) * 100.0)
            .round()
            .clamp(0.0, 100.0) as u8
    } else {
        0
    };
    let mut top_models = payload
        .models
        .into_iter()
        .filter_map(|model| {
            let cost_cny = model
                .cost_cny
                .filter(|cost| cost.is_finite() && *cost > 0.0)?;
            let name = model.model.unwrap_or_else(|| "unknown".to_string());
            Some(AiUsageModel {
                name: short_model_name(&name).to_string(),
                cost_cny,
                requests: model.requests.unwrap_or(0),
            })
        })
        .collect::<Vec<_>>();
    top_models.sort_by(|left, right| right.cost_cny.total_cmp(&left.cost_cny));
    top_models.truncate(3);

    Ok(AiUsage {
        remaining_cny,
        limit_cny,
        remaining_pct,
        days_until_reset,
        today_cost_cny: payload.cost_cny.unwrap_or(0.0),
        today_requests: payload.requests.unwrap_or(0),
        top_models,
    })
}

fn fetch_usage(base_url: &str, api_key: &str) -> Result<AiUsage, String> {
    let date = Local::now().format("%Y%m%d").to_string();
    let url = usage_url(base_url, &date)?;
    let response = ureq::get(url.as_str())
        .set("Accept", "application/json")
        .set("Cookie", &format!("gw_user_apikey={api_key}"))
        .set("User-Agent", concat!("YUME/", env!("CARGO_PKG_VERSION")))
        .timeout(FETCH_TIMEOUT)
        .call();
    match response {
        Ok(response) => {
            let payload = response
                .into_json::<serde_json::Value>()
                .map_err(|_| "invalid_response".to_string())?;
            parse_usage_payload(payload, days_until_next_monday())
        }
        Err(ureq::Error::Status(status, _)) => Err(format!("status:{status}")),
        Err(error) => Err(format!("network:{error}")),
    }
}

#[tauri::command]
pub async fn fetch_ai_usage(base_url: String, api_key: String) -> Result<AiUsage, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("empty_key".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || fetch_usage(&base_url, &api_key))
        .await
        .map_err(|error| format!("task:{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{parse_usage_payload, usage_url};

    #[test]
    fn parses_the_weekly_summary_and_sorts_the_daily_models() {
        let payload = serde_json::json!({
            "period_limit_cny": 30000000,
            "period_remaining_cny": 27260000,
            "requests": 438,
            "cost_cny": 2735900,
            "models": [
                { "model": "yume/gpt-5.4-mini", "cost_cny": 331200, "requests": 218 },
                { "model": "yume/claude-opus-4.8", "cost_cny": 2372500, "requests": 190 },
                { "model": "yume/gpt-5.5", "cost_cny": 22300, "requests": 8 }
            ]
        });

        let usage = parse_usage_payload(payload, 6).expect("fixture has valid usage data");

        assert_eq!(usage.remaining_cny, 27260000.0);
        assert_eq!(usage.limit_cny, 30000000.0);
        assert_eq!(usage.remaining_pct, 91);
        assert_eq!(usage.days_until_reset, 6);
        assert_eq!(usage.top_models[0].name, "claude-opus-4.8");
        assert_eq!(usage.top_models[1].name, "gpt-5.4-mini");
    }

    #[test]
    fn removes_the_openai_v1_suffix_before_building_the_usage_endpoint() {
        let url = usage_url("https://ai-gateway.kurogames.com/v1", "20260827")
            .expect("the gateway URL is valid");

        assert_eq!(
            url.as_str(),
            "https://ai-gateway.kurogames.com/my-usage/api/detail?date=20260827"
        );
    }
}
