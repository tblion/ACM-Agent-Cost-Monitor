use crate::cost::Rate;
use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const EMBEDDED_CATALOG: &str = include_str!("../catalog/pricing.json");
type RateKey<'a> = (&'a str, &'a str);
type IndexedDate = DateTime<FixedOffset>;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct PricingCatalog {
    pub version: u32,
    pub generated_at: String,
    pub source_version: String,
    pub rates: Vec<PricingRate>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct PricingRate {
    pub provider: String,
    pub model: String,
    pub effective_from: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub source: String,
}

impl PricingCatalog {
    pub fn pricing_rate_for(
        &self,
        provider: &str,
        model: &str,
        message_date: i64,
    ) -> Option<&PricingRate> {
        self.rates
            .iter()
            .filter(|rate| rate.provider == provider && rate.model == model)
            .filter_map(|rate| {
                let effective_from = DateTime::parse_from_rfc3339(&rate.effective_from)
                    .ok()?
                    .timestamp_millis();
                (effective_from <= message_date).then_some((effective_from, rate))
            })
            .max_by_key(|(effective_from, _)| *effective_from)
            .map(|(_, rate)| rate)
    }

    pub fn rate_for(&self, provider: &str, model: &str, message_date: i64) -> Option<Rate> {
        self.pricing_rate_for(provider, model, message_date)
            .map(|rate| Rate {
                input: rate.input,
                output: rate.output,
                cache_read: rate.cache_read,
                cache_write: rate.cache_write,
            })
    }
}

pub fn load_embedded_catalog() -> Result<PricingCatalog, String> {
    validate_catalog(EMBEDDED_CATALOG)
}

pub fn validate_catalog(json: &str) -> Result<PricingCatalog, String> {
    if json.trim().is_empty() {
        return Err("pricing catalog is empty".to_string());
    }

    // serde_json keeps the last value for duplicate keys; rejecting them would require a dedicated deserializer, out of scope here.
    let catalog: PricingCatalog = serde_json::from_str(json)
        .map_err(|error| format!("invalid pricing catalog JSON: {error}"))?;

    if catalog.version == 0 {
        return Err("catalog version must be greater than zero".to_string());
    }
    if catalog.source_version.trim().is_empty() {
        return Err("sourceVersion must not be empty".to_string());
    }
    if catalog.rates.is_empty() {
        return Err("rates must not be empty".to_string());
    }
    parse_utc(&catalog.generated_at, "generatedAt")?;

    let mut dates_by_key: HashMap<RateKey<'_>, Vec<IndexedDate>> = HashMap::new();
    for (index, rate) in catalog.rates.iter().enumerate() {
        validate_rate(rate, index)?;
        dates_by_key
            .entry((&rate.provider, &rate.model))
            .or_default()
            .push(parse_effective_from(
                &rate.effective_from,
                &format!("rates[{index}].effectiveFrom"),
            )?);
    }

    for ((provider, model), dates) in dates_by_key {
        for pair in dates.windows(2) {
            if pair[0] == pair[1] {
                return Err(format!(
                    "duplicate effectiveFrom for provider '{provider}' and model '{model}'"
                ));
            }
            if pair[0] > pair[1] {
                return Err(format!(
                    "effectiveFrom dates must be strictly increasing for provider '{provider}' and model '{model}'"
                ));
            }
        }
    }

    Ok(catalog)
}

fn validate_rate(rate: &PricingRate, index: usize) -> Result<(), String> {
    for (field, value) in [
        ("provider", rate.provider.as_str()),
        ("model", rate.model.as_str()),
        ("source", rate.source.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("rates[{index}].{field} must not be empty"));
        }
    }

    parse_effective_from(
        &rate.effective_from,
        &format!("rates[{index}].effectiveFrom"),
    )?;
    for (field, value) in [
        ("input", rate.input),
        ("output", rate.output),
        ("cacheRead", rate.cache_read),
        ("cacheWrite", rate.cache_write),
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(format!(
                "rates[{index}].{field} must be finite and non-negative"
            ));
        }
    }

    Ok(())
}

fn parse_utc(value: &str, field: &str) -> Result<DateTime<FixedOffset>, String> {
    let date = DateTime::parse_from_rfc3339(value)
        .map_err(|error| format!("{field} must be a valid RFC3339 date in UTC: {error}"))?;
    if date.offset().local_minus_utc() != 0 || !value.ends_with('Z') {
        return Err(format!("{field} must be expressed in UTC with a Z suffix"));
    }
    Ok(date)
}

fn parse_effective_from(value: &str, field: &str) -> Result<DateTime<FixedOffset>, String> {
    let date = parse_utc(value, field)?;
    let fraction_digits = value
        .strip_suffix('Z')
        .and_then(|without_timezone| without_timezone.split_once('.'))
        .map(|(_, fraction)| fraction.len())
        .unwrap_or(0);
    if fraction_digits > 3 {
        return Err(format!(
            "{field} must have at most 3 fractional second digits"
        ));
    }
    Ok(date)
}
