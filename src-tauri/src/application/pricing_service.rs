use crate::aggregate::{self, RawRow};
use crate::config;
use crate::cost::Rate;
use crate::db;
use crate::error::{AppError, ErrorCategory};
use crate::model::RateEntry;
use crate::pricing::PricingCatalog;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Hash, PartialEq, Eq)]
struct RateEntryKey {
    provider: String,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    source: String,
    effective_from: Option<String>,
}

impl RateEntryKey {
    fn from_entry(entry: &RateEntry) -> Self {
        let bits = |value: f64| if value == 0.0 { 0 } else { value.to_bits() };
        Self {
            provider: entry.provider.clone(),
            model: entry.model.clone(),
            input: bits(entry.input),
            output: bits(entry.output),
            cache_read: bits(entry.cache_read),
            cache_write: bits(entry.cache_write),
            source: entry.source.clone(),
            effective_from: entry.effective_from.clone(),
        }
    }
}

pub fn rates_for_rows(
    rows: &[RawRow],
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Vec<RateEntry> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        if row.tokens.as_ref().is_none_or(|tokens| !tokens.is_valid()) {
            continue;
        }
        let Some(resolved) = aggregate::resolve_rate_detail(row, catalog, overrides) else {
            continue;
        };
        let entry = RateEntry {
            provider: row.provider.clone(),
            model: row.model.clone(),
            input: resolved.rate.input,
            output: resolved.rate.output,
            cache_read: resolved.rate.cache_read,
            cache_write: resolved.rate.cache_write,
            source: match resolved.source {
                aggregate::RateSource::Configured => "configured".into(),
                aggregate::RateSource::Catalog => "catalog".into(),
            },
            effective_from: resolved.effective_from,
        };
        if seen.insert(RateEntryKey::from_entry(&entry)) {
            entries.push(entry);
        }
    }
    entries.sort_by(|left, right| {
        left.provider
            .cmp(&right.provider)
            .then(left.model.cmp(&right.model))
            .then(left.effective_from.cmp(&right.effective_from))
    });
    entries
}

pub fn catalog_status() -> Result<crate::model::CatalogStatus, crate::error::AppError> {
    let catalog = crate::pricing::load_embedded_catalog().map_err(|message| {
        crate::error::AppError::new(crate::error::ErrorCategory::Pricing, message)
    })?;
    Ok(crate::model::CatalogStatus {
        valid: true,
        version: catalog.version,
        generated_at: catalog.generated_at,
        source_version: catalog.source_version,
        rate_count: catalog.rates.len(),
    })
}

pub fn rates_for_paths(
    database_path: &std::path::Path,
    config_path: &std::path::Path,
) -> Result<Vec<RateEntry>, AppError> {
    let catalog = crate::pricing::load_embedded_catalog()
        .map_err(|message| AppError::new(ErrorCategory::Pricing, message))?;
    let overrides = config::load_rates(config_path)
        .map_err(|message| AppError::new(ErrorCategory::Configuration, message))?;
    let rows = db::load_rows(&database_path.to_string_lossy())
        .map_err(|message| AppError::new(ErrorCategory::Database, message))?;
    Ok(rates_for_rows(&rows, &catalog, &overrides))
}
