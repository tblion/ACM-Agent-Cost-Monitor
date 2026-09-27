mod common;

use common::TemporaryFile;
use opencode_costs_viewer_lib::aggregate::{aggregate, RawRow};
use opencode_costs_viewer_lib::application::audit_service;
use opencode_costs_viewer_lib::audit::{build_audit_report, AuditPaths, IgnoredRow, SessionRow};
use opencode_costs_viewer_lib::config::extract_rates;
use opencode_costs_viewer_lib::cost::Rate;
use opencode_costs_viewer_lib::db::{
    count_messages, count_sessions, load_audit_snapshot, load_rows,
};
use opencode_costs_viewer_lib::model::Tokens;
use opencode_costs_viewer_lib::pricing::{validate_catalog, PricingCatalog, PricingRate};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;

const REFERENCE_SQL: &str = include_str!("fixtures/audit/reference.sql");
const REFERENCE_CONFIG: &str = include_str!("fixtures/audit/reference-config.jsonc");
const REFERENCE_CATALOG: &str = include_str!("fixtures/audit/reference-catalog.json");
const REFERENCE_EXPECTED: &str = include_str!("fixtures/audit/reference-expected.json");

fn temporary_database() -> TemporaryFile {
    TemporaryFile::new("opencode-audit", ".db")
}

#[test]
fn temporary_database_path_is_reserved_before_use() {
    let path = temporary_database();
    let path_copy = path.to_path_buf();

    assert!(path.exists(), "temporary database path must be reserved");

    drop(path);
    assert!(
        !path_copy.exists(),
        "temporary database must be removed on drop"
    );
}

fn ignored_rows(connection: &Connection) -> Vec<IgnoredRow> {
    connection
        .prepare(
            "SELECT id, session_id, json_extract(data, '$.role')
             FROM message
             WHERE json_extract(data, '$.role') <> 'assistant'
             ORDER BY id",
        )
        .expect("prepare ignored-message query")
        .query_map([], |row| {
            Ok(IgnoredRow {
                message_id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
            })
        })
        .expect("query ignored messages")
        .collect::<Result<Vec<_>, _>>()
        .expect("read ignored messages")
}

fn session_rows(connection: &Connection) -> Vec<SessionRow> {
    connection
        .prepare("SELECT id, directory, title, parent_id FROM session ORDER BY id")
        .expect("prepare session query")
        .query_map([], |row| {
            Ok(SessionRow {
                session_id: row.get(0)?,
                project: row.get(1)?,
                title: row.get(2)?,
                parent_id: row.get(3)?,
            })
        })
        .expect("query sessions")
        .collect::<Result<Vec<_>, _>>()
        .expect("read sessions")
}

fn stable_report(mut value: Value) -> Value {
    value
        .as_object_mut()
        .expect("audit report is an object")
        .remove("generatedAt");
    normalize_numbers(value)
}

fn normalize_numbers(value: Value) -> Value {
    match value {
        Value::Number(number) => Value::from(number.as_f64().expect("finite JSON number")),
        Value::Array(values) => Value::Array(values.into_iter().map(normalize_numbers).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, normalize_numbers(value)))
                .collect(),
        ),
        value => value,
    }
}

fn timestamp(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .expect("valid test timestamp")
        .timestamp_millis()
}

fn audit_row(
    message_id: &str,
    session_id: &str,
    message_date: &str,
    provider: &str,
    model: &str,
) -> RawRow {
    RawRow {
        message_id: message_id.into(),
        project: "/audit/test".into(),
        session_id: session_id.into(),
        title: "Audit test".into(),
        parent_id: None,
        date: timestamp(message_date),
        message_date: Some(timestamp(message_date)),
        provider: provider.into(),
        model: model.into(),
        stored_cost: 99.0,
        tokens: Some(Tokens {
            input: 1_000_000.0,
            output: 1_000_000.0,
            cache_read: 0.0,
            cache_write: 0.0,
            reasoning: 0.0,
        }),
    }
}

fn catalog_rates(rates: Vec<PricingRate>) -> PricingCatalog {
    PricingCatalog {
        version: 1,
        generated_at: "2026-09-25T00:00:00Z".into(),
        source_version: "audit-test".into(),
        rates,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IndependentRateSource {
    Configured,
    Catalog,
}

#[derive(Debug, Clone)]
struct IndependentResolvedRate {
    source: IndependentRateSource,
    rate: Rate,
    effective_from: Option<String>,
}

fn independently_resolve_rate(
    row: &RawRow,
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Option<IndependentResolvedRate> {
    if let Some(rate) = overrides.get(&(row.provider.clone(), row.model.clone())) {
        if [rate.input, rate.output, rate.cache_read, rate.cache_write]
            .iter()
            .all(|value| value.is_finite() && *value >= 0.0)
        {
            return Some(IndependentResolvedRate {
                source: IndependentRateSource::Configured,
                rate: *rate,
                effective_from: None,
            });
        }
    }

    let message_date = row.message_date?;
    catalog
        .rates
        .iter()
        .filter(|rate| rate.provider == row.provider && rate.model == row.model)
        .filter_map(|rate| {
            let effective_date = chrono::DateTime::parse_from_rfc3339(&rate.effective_from)
                .ok()?
                .timestamp_millis();
            (effective_date <= message_date).then_some((effective_date, rate))
        })
        .max_by_key(|(effective_date, _)| *effective_date)
        .map(|(_, rate)| IndependentResolvedRate {
            source: IndependentRateSource::Catalog,
            rate: Rate {
                input: rate.input,
                output: rate.output,
                cache_read: rate.cache_read,
                cache_write: rate.cache_write,
            },
            effective_from: Some(rate.effective_from.clone()),
        })
}

fn report_for(
    rows: &[RawRow],
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> opencode_costs_viewer_lib::model::AuditReport {
    let sessions = vec![SessionRow {
        session_id: "audit-session".into(),
        project: "/audit/test".into(),
        title: "Audit test".into(),
        parent_id: None,
    }];
    build_audit_report(
        rows,
        &[],
        &sessions,
        1,
        rows.len(),
        catalog,
        overrides,
        AuditPaths {
            database_path: "audit-test.db".into(),
            config_path: "audit-test.jsonc".into(),
            catalog_path: "audit-test.json".into(),
        },
    )
    .expect("build audit test report")
}

#[test]
fn builds_the_golden_audit_report_from_the_reference_database() {
    let database_path = temporary_database();
    let connection = Connection::open(&database_path).expect("create temporary database");
    connection
        .execute_batch(REFERENCE_SQL)
        .expect("load reference SQL");
    let ignored = ignored_rows(&connection);
    let sessions = session_rows(&connection);
    drop(connection);

    let rows = load_rows(database_path.to_str().expect("database path is UTF-8"))
        .expect("load assistant rows");
    let total_sessions = count_sessions(database_path.to_str().expect("database path is UTF-8"))
        .expect("count database sessions") as usize;
    let total_messages = count_messages(database_path.to_str().expect("database path is UTF-8"))
        .expect("count database messages") as usize;
    let overrides = extract_rates(REFERENCE_CONFIG).expect("load JSONC configuration");
    let catalog = validate_catalog(REFERENCE_CATALOG).expect("load pricing catalog");

    let report = build_audit_report(
        &rows,
        &ignored,
        &sessions,
        total_sessions,
        total_messages,
        &catalog,
        &overrides,
        AuditPaths {
            database_path: "reference.sql".into(),
            config_path: "reference-config.jsonc".into(),
            catalog_path: "reference-catalog.json".into(),
        },
    )
    .expect("build audit report");

    let actual = serde_json::to_value(&report).expect("serialize audit report");
    let expected: Value = serde_json::from_str(REFERENCE_EXPECTED).expect("parse golden report");

    assert_eq!(stable_report(actual.clone()), stable_report(expected));
    assert!(actual["generatedAt"]
        .as_str()
        .is_some_and(|value| { chrono::DateTime::parse_from_rfc3339(value).is_ok() }));
    assert_eq!(actual["provenance"]["databasePath"], "reference.sql");
    assert_eq!(actual["provenance"]["configPath"], "reference-config.jsonc");
    assert_eq!(
        actual["provenance"]["catalogPath"],
        "reference-catalog.json"
    );

    let messages = actual["messages"]
        .as_array()
        .expect("report messages are an array");
    let message_counts = messages
        .iter()
        .fold(BTreeMap::new(), |mut counts, message| {
            *counts
                .entry(message["messageId"].as_str().expect("message ID"))
                .or_insert(0usize) += 1;
            counts
        });
    assert_eq!(messages.len(), rows.len());
    assert!(message_counts.values().all(|count| *count == 1));
    assert_eq!(actual["summary"]["ignoredMessages"], ignored.len());
    assert_eq!(actual["ignored"].as_array().unwrap().len(), ignored.len());
    assert_eq!(actual["ignored"][0]["messageId"], "u-custom");
    assert_eq!(actual["ignored"][0]["role"], "user");
    assert_eq!(actual["summary"]["allSessions"], 7);
    assert_eq!(actual["summary"]["sessionsWithAssistant"], 6);
    assert_eq!(actual["sessions"].as_array().unwrap().len(), 7);
    assert_eq!(actual["sessions"][2]["sessionId"], "s-empty");
    assert_eq!(actual["sessions"][2]["assistantMessages"], 0);
    assert_eq!(actual["sessions"][2]["messageIds"], Value::Array(vec![]));

    let serialized = serde_json::to_string(&actual).expect("serialize audit report JSON");
    assert!(!serialized.contains("prompt"));
    assert!(!serialized.contains("response"));
}

#[test]
fn command_helper_builds_audit_report_and_rejects_a_missing_database() {
    let database_path = temporary_database();
    let config_path = TemporaryFile::new("opencode-audit-config", ".jsonc");
    let connection = Connection::open(&database_path).expect("create temporary database");
    connection
        .execute_batch(REFERENCE_SQL)
        .expect("load reference SQL");
    drop(connection);
    fs::write(&config_path, REFERENCE_CONFIG).expect("write reference configuration");

    let report = audit_service::build_audit_report_for_paths(&database_path, &config_path)
        .expect("build audit report from command helper");

    assert!(report.valid);
    assert!(chrono::DateTime::parse_from_rfc3339(&report.generated_at).is_ok());

    let missing_database = TemporaryFile::new("opencode-audit-missing", ".db");
    fs::remove_file(missing_database.as_ref()).expect("remove reserved missing database");
    let error = audit_service::build_audit_report_for_paths(&missing_database, &config_path)
        .expect_err("missing database must fail");

    assert!(!error.is_empty());
    assert!(!missing_database.exists());
}

#[test]
fn command_helper_rejects_missing_and_invalid_configuration() {
    let database_path = temporary_database();
    let connection = Connection::open(&database_path).expect("create temporary database");
    connection
        .execute_batch(REFERENCE_SQL)
        .expect("load reference SQL");
    drop(connection);

    let missing_config = TemporaryFile::new("opencode-audit-missing-config", ".jsonc");
    fs::remove_file(missing_config.as_ref()).expect("remove reserved missing configuration");
    let missing_error =
        audit_service::build_audit_report_for_paths(&database_path, &missing_config)
            .expect_err("missing audit configuration must fail");
    assert!(missing_error.contains("configuration"));

    let invalid_config = TemporaryFile::new("opencode-audit-invalid-config", ".jsonc");
    fs::write(&invalid_config, "{ invalid").expect("write invalid configuration");
    let invalid_error =
        audit_service::build_audit_report_for_paths(&database_path, &invalid_config)
            .expect_err("invalid audit configuration must fail");
    assert!(invalid_error.contains("JSON invalide"));
}

#[test]
fn audit_snapshot_keeps_rows_metadata_and_counts_from_one_read_snapshot() {
    let database_path = temporary_database();
    let connection = Connection::open(&database_path).expect("create temporary database");
    connection
        .execute_batch(REFERENCE_SQL)
        .expect("load reference SQL");
    drop(connection);

    let snapshot = load_audit_snapshot(database_path.to_str().expect("database path is UTF-8"))
        .expect("load coherent audit snapshot");

    assert_eq!(snapshot.total_sessions, 7);
    assert_eq!(snapshot.total_messages, 10);
    assert_eq!(snapshot.session_rows.len(), 7);
    assert_eq!(snapshot.rows.len(), 9);
    assert_eq!(snapshot.ignored_rows.len(), 1);
    assert_eq!(
        snapshot.rows.len() + snapshot.ignored_rows.len(),
        snapshot.total_messages as usize
    );
    assert_eq!(
        snapshot.session_rows.len(),
        snapshot.total_sessions as usize
    );
}

#[test]
fn export_helper_writes_exact_content_and_reports_filesystem_errors() {
    let path = TemporaryFile::new("opencode-audit-export", ".json");
    let content = "{\"valid\":true}\n";

    opencode_costs_viewer_lib::commands::write_export_file(&path, content)
        .expect("write export file");
    assert_eq!(
        fs::read_to_string(&path).expect("read export file"),
        content
    );

    let missing_parent = path.with_file_name("missing-export-parent");
    let error = opencode_costs_viewer_lib::commands::write_export_file(
        &missing_parent.join("audit.json"),
        content,
    )
    .expect_err("filesystem error must be returned");
    assert!(!error.is_empty());
}

#[test]
fn audit_uses_custom_override_over_a_concurrent_catalog_rate() {
    let rows = vec![audit_row(
        "custom-message",
        "audit-session",
        "2026-06-01T00:00:00Z",
        "same-provider",
        "same-model",
    )];
    let catalog = catalog_rates(vec![PricingRate {
        provider: "same-provider".into(),
        model: "same-model".into(),
        effective_from: "2025-01-01T00:00:00Z".into(),
        input: 1.0,
        output: 2.0,
        cache_read: 0.0,
        cache_write: 0.0,
        source: "audit-test".into(),
    }]);
    let mut overrides = HashMap::new();
    overrides.insert(
        ("same-provider".into(), "same-model".into()),
        Rate {
            input: 10.0,
            output: 20.0,
            cache_read: 0.0,
            cache_write: 0.0,
        },
    );

    let report = report_for(&rows, &catalog, &overrides);
    let message = &report.messages[0];
    let expected =
        independently_resolve_rate(&rows[0], &catalog, &overrides).expect("configured rate");

    assert!(report.valid);
    assert_eq!(expected.source, IndependentRateSource::Configured);
    assert_eq!(expected.effective_from, None);
    assert!(matches!(
        message.rate_source,
        Some(opencode_costs_viewer_lib::model::AuditRateSource::Configured)
    ));
    assert_eq!(message.effective_from, None);
    assert_eq!(message.rate.as_ref().expect("configured rate").input, 10.0);
    assert_eq!(message.calculated_cost, Some(30.0));
}

#[test]
fn audit_selects_catalog_rate_by_message_date_for_old_and_new_messages() {
    let rows = vec![
        audit_row(
            "old-message",
            "audit-session",
            "2025-06-01T00:00:00Z",
            "history-provider",
            "history-model",
        ),
        audit_row(
            "new-message",
            "audit-session",
            "2026-06-01T00:00:00Z",
            "history-provider",
            "history-model",
        ),
    ];
    let catalog = catalog_rates(vec![
        PricingRate {
            provider: "history-provider".into(),
            model: "history-model".into(),
            effective_from: "2025-01-01T00:00:00Z".into(),
            input: 1.0,
            output: 2.0,
            cache_read: 0.0,
            cache_write: 0.0,
            source: "audit-test".into(),
        },
        PricingRate {
            provider: "history-provider".into(),
            model: "history-model".into(),
            effective_from: "2026-01-01T00:00:00Z".into(),
            input: 3.0,
            output: 4.0,
            cache_read: 0.0,
            cache_write: 0.0,
            source: "audit-test".into(),
        },
    ]);

    let report = report_for(&rows, &catalog, &HashMap::new());
    let expected_old =
        independently_resolve_rate(&rows[0], &catalog, &HashMap::new()).expect("old catalog rate");
    let expected_new =
        independently_resolve_rate(&rows[1], &catalog, &HashMap::new()).expect("new catalog rate");

    assert!(report.valid);
    let old_message = report
        .messages
        .iter()
        .find(|message| message.message_id == "old-message")
        .expect("old message");
    let new_message = report
        .messages
        .iter()
        .find(|message| message.message_id == "new-message")
        .expect("new message");
    assert_eq!(
        old_message.effective_from.as_deref(),
        Some("2025-01-01T00:00:00Z")
    );
    assert_eq!(expected_old.source, IndependentRateSource::Catalog);
    assert_eq!(
        expected_old.effective_from.as_deref(),
        Some("2025-01-01T00:00:00Z")
    );
    assert_eq!(expected_old.rate.input, 1.0);
    assert_eq!(
        old_message.rate.as_ref().expect("old catalog rate").input,
        1.0
    );
    assert_eq!(
        new_message.effective_from.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
    assert_eq!(expected_new.source, IndependentRateSource::Catalog);
    assert_eq!(
        expected_new.effective_from.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
    assert_eq!(expected_new.rate.input, 3.0);
    assert_eq!(
        new_message.rate.as_ref().expect("new catalog rate").input,
        3.0
    );
}

#[test]
fn audit_reports_invalid_custom_rate_before_catalog_fallback() {
    let rows = vec![audit_row(
        "invalid-custom-message",
        "audit-session",
        "2026-06-01T00:00:00Z",
        "same-provider",
        "same-model",
    )];
    let catalog = catalog_rates(vec![PricingRate {
        provider: "same-provider".into(),
        model: "same-model".into(),
        effective_from: "2025-01-01T00:00:00Z".into(),
        input: 1.0,
        output: 2.0,
        cache_read: 0.0,
        cache_write: 0.0,
        source: "audit-test".into(),
    }]);
    let mut overrides = HashMap::new();
    overrides.insert(
        ("same-provider".into(), "same-model".into()),
        Rate {
            input: -1.0,
            output: 20.0,
            cache_read: 0.0,
            cache_write: 0.0,
        },
    );

    let report = report_for(&rows, &catalog, &overrides);

    assert!(report.valid);
    assert_eq!(report.messages[0].selected_cost, 3.0);
    assert_eq!(report.messages[0].calculated_cost, Some(3.0));
    assert!(matches!(
        report.messages[0].rate_source,
        Some(opencode_costs_viewer_lib::model::AuditRateSource::Catalog)
    ));
    assert!(report.messages[0].anomalies.iter().any(|anomaly| matches!(
        anomaly,
        opencode_costs_viewer_lib::model::AuditAnomaly::InvalidRate
    )));
    assert_eq!(report.summary.anomaly_counts.invalid_rate, 1);
}

#[test]
fn aggregate_and_audit_reject_the_same_invalid_custom_rates() {
    let rows = vec![audit_row(
        "invalid-custom-message",
        "audit-session",
        "2026-06-01T00:00:00Z",
        "same-provider",
        "same-model",
    )];
    let catalog = catalog_rates(vec![PricingRate {
        provider: "same-provider".into(),
        model: "same-model".into(),
        effective_from: "2025-01-01T00:00:00Z".into(),
        input: 1.0,
        output: 2.0,
        cache_read: 0.0,
        cache_write: 0.0,
        source: "audit-test".into(),
    }]);

    for invalid_rate in [
        Rate {
            input: -1.0,
            output: 20.0,
            cache_read: 0.0,
            cache_write: 0.0,
        },
        Rate {
            input: f64::NAN,
            output: 20.0,
            cache_read: 0.0,
            cache_write: 0.0,
        },
    ] {
        let mut overrides = HashMap::new();
        overrides.insert(("same-provider".into(), "same-model".into()), invalid_rate);

        let expected = independently_resolve_rate(&rows[0], &catalog, &overrides)
            .expect("catalog fallback rate");
        let report = report_for(&rows, &catalog, &overrides);
        let aggregate_session = aggregate(&rows, &catalog, &overrides)
            .into_iter()
            .next()
            .expect("aggregate session");
        let message = &report.messages[0];

        assert_eq!(expected.source, IndependentRateSource::Catalog);
        assert_eq!(expected.rate.input, 1.0);
        assert_eq!(aggregate_session.cost, 3.0);
        assert_eq!(message.selected_cost, aggregate_session.cost);
        assert_eq!(message.calculated_cost, Some(3.0));
        assert!(matches!(
            message.rate_source,
            Some(opencode_costs_viewer_lib::model::AuditRateSource::Catalog)
        ));
        assert!(message.anomalies.iter().any(|anomaly| matches!(
            anomaly,
            opencode_costs_viewer_lib::model::AuditAnomaly::InvalidRate
        )));
        assert_eq!(report.summary.anomaly_counts.invalid_rate, 1);
    }
}
