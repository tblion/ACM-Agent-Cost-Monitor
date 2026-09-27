use crate::aggregate::{self, RawRow};
use crate::config;
use crate::db;
use crate::error::{AppError, ErrorCategory};
use crate::model::{
    CostSummary, RecalculationDiagnostics, RecalculationResult, RuntimeMetrics, SessionRecord,
};
use crate::pricing;
use std::collections::HashMap;
use std::path::Path;

fn database_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCategory::Database, message)
}

fn configuration_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCategory::Configuration, message)
}

fn pricing_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCategory::Pricing, message)
}

pub fn compute(db_path: &Path, config_path: &Path) -> Result<Vec<SessionRecord>, AppError> {
    let rates = config::load_rates(config_path).map_err(configuration_error)?;
    let rows = db::load_rows(&db_path.to_string_lossy()).map_err(database_error)?;
    let catalog = pricing::load_embedded_catalog().map_err(pricing_error)?;
    Ok(aggregate::aggregate(&rows, &catalog, &rates))
}

pub fn compute_cost_summary(
    db_path: &Path,
    config_path: &Path,
) -> Result<Vec<CostSummary>, AppError> {
    let rates = config::load_rates(config_path).map_err(configuration_error)?;
    let mut summaries =
        db::load_cost_summary(&db_path.to_string_lossy()).map_err(database_error)?;
    for summary in &mut summaries {
        summary.configured = rates.contains_key(&(summary.provider.clone(), summary.model.clone()));
    }
    Ok(summaries)
}

pub fn diagnostics(
    rows: &[RawRow],
    catalog: &pricing::PricingCatalog,
    rates: &HashMap<(String, String), crate::cost::Rate>,
) -> RecalculationDiagnostics {
    // Each counter describes an independent dimension, as in the audit.
    let mut result = RecalculationDiagnostics {
        catalogue_valid: true,
        recalculable_messages: 0,
        missing_dates: 0,
        missing_tokens: 0,
        missing_rates: 0,
    };
    for row in rows {
        if row.message_date.is_none() {
            result.missing_dates += 1;
        }
        if row.tokens.as_ref().is_none_or(|tokens| !tokens.is_valid()) {
            result.missing_tokens += 1;
        }
        let has_rate = aggregate::resolve_rate(row, catalog, rates).is_some();
        if row.tokens.as_ref().is_some_and(|tokens| tokens.is_valid()) && has_rate {
            result.recalculable_messages += 1;
        }
        if !has_rate {
            result.missing_rates += 1;
        }
    }
    result
}

pub fn recalculate(db_path: &Path, config_path: &Path) -> Result<RecalculationResult, AppError> {
    let rates = config::load_rates(config_path).map_err(configuration_error)?;
    let rows = db::load_rows(&db_path.to_string_lossy()).map_err(database_error)?;
    let catalog = pricing::load_embedded_catalog().map_err(pricing_error)?;
    Ok(RecalculationResult {
        sessions: aggregate::aggregate(&rows, &catalog, &rates),
        diagnostics: diagnostics(&rows, &catalog, &rates),
    })
}

pub fn runtime_metrics(database_path: Option<&Path>) -> RuntimeMetrics {
    crate::runtime::collect(database_path)
}
