use opencode_costs_viewer_lib::error::{AppError, ErrorCategory};
use opencode_costs_viewer_lib::model::{
    AuditAnomaly, AuditAnomalyCounts, AuditCostSource, AuditInvariantStatus, AuditMessage,
    AuditProvenance, AuditRateSource, AuditReport, AuditSession, AuditSummary, CatalogStatus,
    CostSource, CostSummary, CustomGroup, ModelUsage, RateEntry, RecalculationDiagnostics,
    RecalculationResult, ResolvedPaths, RuntimeMetrics, SessionRecord, Settings, SettingsResponse,
    Tokens,
};

fn tokens() -> Tokens {
    Tokens {
        input: 1.0,
        output: 2.0,
        cache_read: 3.0,
        cache_write: 4.0,
        reasoning: 5.0,
    }
}

#[test]
fn public_payloads_serialize_with_camel_case_nulls_and_stable_enums() {
    let session = SessionRecord {
        id: "session".into(),
        project: "project".into(),
        title: "title".into(),
        date: 1,
        cost: 2.0,
        tokens: tokens(),
        is_subagent: false,
        parent_id: None,
        source: CostSource::Configured,
        models: vec![ModelUsage {
            provider: "provider".into(),
            model: "model".into(),
            cost: 2.0,
            tokens: tokens(),
            source: CostSource::Stored,
        }],
    };
    let session_json = serde_json::to_value(session).unwrap();
    assert_eq!(session_json["isSubagent"], false);
    assert_eq!(session_json["parentId"], serde_json::Value::Null);
    assert_eq!(session_json["source"], "configured");
    assert_eq!(session_json["models"][0]["source"], "stored");
    assert_eq!(session_json["tokens"]["cacheRead"], 3.0);

    let settings = Settings {
        db_path: None,
        config_path: None,
        live: false,
        theme: "system".into(),
        language: None,
        default_period_days: 30,
        custom_groups: vec![CustomGroup {
            name: "group".into(),
            projects: vec!["project".into()],
        }],
    };
    let status = SettingsResponse {
        settings,
        diagnostic: None,
        live_active: false,
    };
    let status_json = serde_json::to_value(status).unwrap();
    assert_eq!(status_json["settings"]["dbPath"], serde_json::Value::Null);
    assert_eq!(status_json["diagnostic"], serde_json::Value::Null);
    assert_eq!(status_json["liveActive"], false);

    let values = vec![
        serde_json::to_value(CostSummary {
            provider: "provider".into(),
            model: "model".into(),
            messages: 1,
            stored_cost: 1.0,
            configured: true,
        })
        .unwrap(),
        serde_json::to_value(ResolvedPaths {
            db: "db".into(),
            config: "config".into(),
        })
        .unwrap(),
        serde_json::to_value(RateEntry {
            provider: "provider".into(),
            model: "model".into(),
            input: 1.0,
            output: 2.0,
            cache_read: 0.0,
            cache_write: 0.0,
            source: "catalog".into(),
            effective_from: None,
        })
        .unwrap(),
        serde_json::to_value(RuntimeMetrics {
            database_size_bytes: None,
            process_memory_bytes: Some(10),
            measured_at: 1,
        })
        .unwrap(),
        serde_json::to_value(CatalogStatus {
            valid: true,
            version: 1,
            generated_at: "generated".into(),
            source_version: "source".into(),
            rate_count: 1,
        })
        .unwrap(),
        serde_json::to_value(RecalculationResult {
            sessions: vec![],
            diagnostics: RecalculationDiagnostics {
                catalogue_valid: true,
                recalculable_messages: 1,
                missing_dates: 0,
                missing_tokens: 0,
                missing_rates: 0,
            },
        })
        .unwrap(),
    ];
    assert_eq!(values[2]["effectiveFrom"], serde_json::Value::Null);
    assert_eq!(values[3]["databaseSizeBytes"], serde_json::Value::Null);
    assert_eq!(values[4]["sourceVersion"], "source");
    assert_eq!(values[5]["diagnostics"]["catalogueValid"], true);
}

#[test]
fn audit_payload_serializes_optional_details_and_all_public_enum_values() {
    let report = AuditReport {
        generated_at: "generated".into(),
        valid: false,
        provenance: AuditProvenance {
            database_path: "db".into(),
            config_path: "config".into(),
            catalog_path: "catalog".into(),
            catalog_version: 1,
            catalog_source_version: "source".into(),
            catalog_generated_at: "generated".into(),
            catalog_rate_count: 1,
        },
        summary: AuditSummary {
            all_sessions: 1,
            total_messages: 1,
            sessions_with_assistant: 1,
            assistant_messages: 1,
            ignored_messages: 0,
            recalculable_messages: 0,
            custom_rate_messages: 0,
            catalog_rate_messages: 0,
            stored_fallback_messages: 1,
            missing_token_messages: 1,
            missing_date_messages: 1,
            missing_rate_messages: 0,
            stored_cost_total: 1.0,
            calculated_cost_total: 0.0,
            selected_cost_total: 1.0,
            tokens: tokens(),
            anomaly_counts: AuditAnomalyCounts {
                missing_tokens: 1,
                missing_date: 1,
                missing_rate: 0,
                invalid_rate: 0,
                stored_cost_fallback: 1,
            },
        },
        messages: vec![AuditMessage {
            message_id: "message".into(),
            session_id: "session".into(),
            project: "project".into(),
            provider: "provider".into(),
            model: "model".into(),
            message_date: None,
            tokens: None,
            stored_cost: 1.0,
            calculated_cost: None,
            selected_cost: 1.0,
            cost_source: AuditCostSource::Stored,
            rate_source: Some(AuditRateSource::Catalog),
            effective_from: None,
            rate: None,
            breakdown: None,
            anomalies: vec![AuditAnomaly::MissingDate, AuditAnomaly::StoredCostFallback],
        }],
        ignored: vec![],
        sessions: vec![AuditSession {
            session_id: "session".into(),
            project: "project".into(),
            title: "title".into(),
            parent_id: None,
            assistant_messages: 1,
            cost: 1.0,
            tokens: tokens(),
            message_ids: vec!["message".into()],
        }],
        invariants: AuditInvariantStatus {
            valid: true,
            failed: vec![],
        },
    };
    let json = serde_json::to_value(report).unwrap();

    assert_eq!(json["messages"][0]["messageDate"], serde_json::Value::Null);
    assert_eq!(json["messages"][0]["rateSource"], "catalog");
    assert_eq!(json["messages"][0]["costSource"], "stored");
    assert_eq!(json["messages"][0]["anomalies"][0], "missingDate");
    assert_eq!(json["messages"][0]["anomalies"][1], "storedCostFallback");
    assert_eq!(json["sessions"][0]["parentId"], serde_json::Value::Null);
}

#[test]
fn public_errors_serialize_as_api_error_objects() {
    let error = AppError::new(ErrorCategory::InvalidInput, "invalid settings");

    assert_eq!(
        serde_json::to_value(error).unwrap(),
        serde_json::json!({"code": "invalid_input", "message": "invalid settings"})
    );
}
