use crate::audit::AuditPaths;
use crate::config;
use crate::db;
use crate::error::{AppError, ErrorCategory};
use crate::model::AuditReport;
use crate::pricing;
use std::path::Path;

pub fn build_audit_report_for_paths(
    database_path: &Path,
    config_path: &Path,
) -> Result<AuditReport, AppError> {
    let database_path_string = database_path.to_string_lossy().into_owned();
    let config_path_string = config_path.to_string_lossy().into_owned();
    let snapshot = db::load_audit_snapshot(&database_path_string)
        .map_err(|message| AppError::new(ErrorCategory::Database, message))?;
    let total_sessions = usize::try_from(snapshot.total_sessions).map_err(|error| {
        AppError::new(
            ErrorCategory::Database,
            format!("Nombre de sessions invalide: {error}"),
        )
    })?;
    let total_messages = usize::try_from(snapshot.total_messages).map_err(|error| {
        AppError::new(
            ErrorCategory::Database,
            format!("Nombre de messages invalide: {error}"),
        )
    })?;
    let overrides = config::load_rates_strict(config_path)
        .map_err(|message| AppError::new(ErrorCategory::Configuration, message))?;
    let catalog = pricing::load_embedded_catalog()
        .map_err(|message| AppError::new(ErrorCategory::Pricing, message))?;

    crate::audit::build_audit_report(
        &snapshot.rows,
        &snapshot.ignored_rows,
        &snapshot.session_rows,
        total_sessions,
        total_messages,
        &catalog,
        &overrides,
        AuditPaths {
            database_path: database_path_string,
            config_path: config_path_string,
            catalog_path: "embedded://pricing.json".into(),
        },
    )
    .map_err(|message| AppError::new(ErrorCategory::Pricing, message))
}
