use std::collections::HashSet;
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use opencode_costs_viewer_lib::aggregate::{aggregate, resolve_rate_detail, RateSource, RawRow};
use opencode_costs_viewer_lib::cost::Rate;
use opencode_costs_viewer_lib::db::load_rows;
use opencode_costs_viewer_lib::model::{CostSource, Tokens};
use opencode_costs_viewer_lib::pricing::{load_embedded_catalog, validate_catalog, PricingCatalog};

fn catalog_with_rates(rates: &str) -> String {
    format!(
        r#"{{"version":1,"generatedAt":"2026-09-23T12:00:00Z","sourceVersion":"fixture-1","rates":[{}]}}"#,
        rates
    )
}

fn rate(provider: &str, model: &str, effective_from: &str) -> String {
    format!(
        r#"{{"provider":"{provider}","model":"{model}","effectiveFrom":"{effective_from}","input":1.0,"output":2.0,"cacheRead":0.0,"cacheWrite":0.0,"source":"fixture"}}"#
    )
}

struct TempPath(PathBuf);

impl TempPath {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn unique_temp_path(label: &str) -> TempPath {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    for attempt in 0..100 {
        let path = std::env::temp_dir().join(format!(
            "opencode-costs-viewer-{label}-{timestamp}-{}-{attempt}",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => {
                fs::remove_file(&path).expect("release temporary path");
                return TempPath(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => panic!("create temporary path: {error}"),
        }
    }
    panic!("could not allocate a unique temporary path");
}

#[test]
fn pricing_rejects_invalid_catalog_entries() {
    let catalog = catalog_with_rates(
        r#"{"provider":"","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
    );

    assert!(validate_catalog(&catalog).is_err());
}

#[test]
fn pricing_rejects_invalid_dates_and_numbers() {
    let invalid_date = catalog_with_rates(
        r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-02-29T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
    );
    let negative_rate = catalog_with_rates(
        r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":-1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
    );

    let error = validate_catalog(&invalid_date).expect_err("invalid date should fail");
    assert!(error.contains("rates[0].effectiveFrom"));
    assert!(validate_catalog(&negative_rate).is_err());
}

#[test]
fn pricing_rejects_effective_from_precision_below_milliseconds() {
    let catalog = catalog_with_rates(
        r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T00:00:00.9999Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
    );

    let error = validate_catalog(&catalog).expect_err("sub-millisecond effectiveFrom should fail");
    assert!(error.contains("at most 3 fractional second digits"));
}

#[test]
fn pricing_rejects_overlapping_effective_dates() {
    let catalog = catalog_with_rates(&format!(
        "{},{}",
        rate("openai", "gpt-5.4", "2026-01-01T00:00:00Z"),
        rate("openai", "gpt-5.4", "2025-12-01T00:00:00Z"),
    ));

    assert!(validate_catalog(&catalog).is_err());
}

#[test]
fn pricing_rejects_duplicate_rates() {
    let entry = rate("openai", "gpt-5.4", "2026-01-01T00:00:00Z");
    let catalog = catalog_with_rates(&format!("{entry},{entry}"));

    assert!(validate_catalog(&catalog).is_err());
}

#[test]
fn pricing_accepts_multiple_non_overlapping_versions() {
    let catalog = catalog_with_rates(&format!(
        "{},{}",
        rate("openai", "gpt-5.4", "2025-01-01T00:00:00Z"),
        rate("openai", "gpt-5.4", "2026-01-01T00:00:00Z"),
    ));

    assert!(validate_catalog(&catalog).is_ok());
}

#[test]
fn pricing_selects_rate_at_exact_boundary_and_falls_back_before_first_rate() {
    let catalog = validate_catalog(&catalog_with_rates(&format!(
        "{},{}",
        rate("openai", "gpt-5.4", "2026-01-01T00:00:00Z"),
        rate("openai", "gpt-5.4", "2026-06-01T00:00:00Z"),
    )))
    .expect("valid catalog");

    let at_boundary = DateTime::parse_from_rfc3339("2026-06-01T00:00:00Z").unwrap();
    let before_first = DateTime::parse_from_rfc3339("2025-12-31T23:59:59Z").unwrap();

    assert_eq!(
        catalog
            .rate_for("openai", "gpt-5.4", at_boundary.timestamp_millis())
            .unwrap()
            .input,
        1.0
    );
    assert!(catalog
        .rate_for("openai", "gpt-5.4", before_first.timestamp_millis())
        .is_none());
}

#[test]
fn aggregate_uses_message_date_for_historical_rates() {
    let catalog = validate_catalog(&catalog_with_rates(&format!(
        "{},{}",
        rate("openai", "gpt-5.4", "2026-01-01T00:00:00Z"),
        r#"{"provider":"openai","model":"gpt-5.4","effectiveFrom":"2026-06-01T00:00:00Z","input":3.0,"output":2.0,"cacheRead":0.0,"cacheWrite":0.0,"source":"fixture"}"#,
    )))
    .expect("valid catalog");
    let before = DateTime::parse_from_rfc3339("2026-05-01T00:00:00Z")
        .unwrap()
        .timestamp_millis();
    let after = DateTime::parse_from_rfc3339("2026-07-01T00:00:00Z")
        .unwrap()
        .timestamp_millis();
    let rows = vec![
        opencode_costs_viewer_lib::aggregate::RawRow {
            message_id: "before-message".into(),
            project: "project".into(),
            session_id: "before".into(),
            title: "before".into(),
            parent_id: None,
            date: before,
            message_date: Some(before),
            provider: "openai".into(),
            model: "gpt-5.4".into(),
            stored_cost: 9.0,
            tokens: Some(Tokens {
                input: 1_000_000.0,
                ..Tokens::default()
            }),
        },
        opencode_costs_viewer_lib::aggregate::RawRow {
            message_id: "after-message".into(),
            project: "project".into(),
            session_id: "after".into(),
            title: "after".into(),
            parent_id: None,
            date: after,
            message_date: Some(after),
            provider: "openai".into(),
            model: "gpt-5.4".into(),
            stored_cost: 9.0,
            tokens: Some(Tokens {
                input: 1_000_000.0,
                ..Tokens::default()
            }),
        },
    ];

    let sessions = aggregate(&rows, &catalog, &std::collections::HashMap::new());

    assert_eq!(
        sessions.iter().find(|s| s.id == "before").unwrap().cost,
        1.0
    );
    assert_eq!(sessions.iter().find(|s| s.id == "after").unwrap().cost, 3.0);
}

#[test]
fn rate_resolution_exposes_override_and_catalog_provenance() {
    let catalog = validate_catalog(&catalog_with_rates(&format!(
        "{},{}",
        rate("openai", "gpt-5.4", "2025-01-01T00:00:00Z"),
        r#"{"provider":"openai","model":"gpt-5.4","effectiveFrom":"2026-01-01T00:00:00Z","input":3.0,"output":4.0,"cacheRead":0.0,"cacheWrite":0.0,"source":"fixture"}"#,
    )))
    .expect("valid catalog");
    let row = RawRow {
        message_id: "message".into(),
        project: "project".into(),
        session_id: "session".into(),
        title: "title".into(),
        parent_id: None,
        date: 1_700_000_000_000,
        message_date: Some(1_800_000_000_000),
        provider: "openai".into(),
        model: "gpt-5.4".into(),
        stored_cost: 0.0,
        tokens: Some(Tokens::default()),
    };
    let mut overrides = std::collections::HashMap::new();
    overrides.insert(
        ("openai".into(), "gpt-5.4".into()),
        Rate {
            input: 9.0,
            output: 8.0,
            cache_read: 7.0,
            cache_write: 6.0,
        },
    );

    let configured = resolve_rate_detail(&row, &catalog, &overrides).expect("configured rate");
    assert_eq!(configured.source, RateSource::Configured);
    assert_eq!(configured.effective_from, None);

    let catalog_rate = resolve_rate_detail(&row, &catalog, &std::collections::HashMap::new())
        .expect("catalog rate");
    assert_eq!(catalog_rate.source, RateSource::Catalog);
    assert_eq!(
        catalog_rate.effective_from.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
}

#[test]
fn aggregate_uses_stored_cost_before_first_catalog_rate() {
    let catalog = validate_catalog(&catalog_with_rates(&rate(
        "openai",
        "gpt-5.4",
        "2026-01-01T00:00:00Z",
    )))
    .expect("valid catalog");
    let date = DateTime::<Utc>::from_timestamp_millis(1_700_000_000_000)
        .unwrap()
        .timestamp_millis();
    let row = opencode_costs_viewer_lib::aggregate::RawRow {
        message_id: "stored-message".into(),
        project: "project".into(),
        session_id: "stored".into(),
        title: "stored".into(),
        parent_id: None,
        date,
        message_date: Some(date),
        provider: "openai".into(),
        model: "gpt-5.4".into(),
        stored_cost: 4.5,
        tokens: Some(Tokens {
            input: 1_000_000.0,
            ..Tokens::default()
        }),
    };

    let sessions = aggregate(&[row], &catalog, &std::collections::HashMap::new());

    assert_eq!(sessions[0].cost, 4.5);
}

#[test]
fn aggregate_uses_stored_cost_when_message_date_is_unavailable() {
    let catalog = load_embedded_catalog().expect("embedded catalog");
    let row = opencode_costs_viewer_lib::aggregate::RawRow {
        message_id: "missing-date-message".into(),
        project: "project".into(),
        session_id: "missing-date".into(),
        title: "missing-date".into(),
        parent_id: None,
        date: 1_700_000_000_000,
        message_date: None,
        provider: "openai".into(),
        model: "gpt-5.4".into(),
        stored_cost: 2.25,
        tokens: Some(Tokens {
            input: 1_000_000.0,
            ..Tokens::default()
        }),
    };

    let sessions = aggregate(&[row], &catalog, &std::collections::HashMap::new());

    assert_eq!(sessions[0].cost, 2.25);
    assert_eq!(sessions[0].source, CostSource::Stored);
}

#[test]
fn calculation_does_not_modify_read_only_database() {
    let path = unique_temp_path("read-only-calculation");
    {
        let connection = rusqlite::Connection::open(path.path()).expect("create database");
        connection
            .execute_batch(
                "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, parent_id TEXT, time_created INTEGER NOT NULL);
                 CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
                 INSERT INTO session VALUES ('s1', '/project', 'title', NULL, 1700000000000);
                 INSERT INTO session VALUES ('s2', '/project', 'invalid date', NULL, 1700000000000);
                 INSERT INTO message VALUES ('m1', 's1', 1700000000001, 1700000000002, '{\"role\":\"assistant\",\"providerID\":\"openai\",\"modelID\":\"gpt-5.4\",\"cost\":2.25,\"tokens\":{\"input\":1000000}}');
                 INSERT INTO message VALUES ('m2', 's2', 'invalid', 1700000000002, '{\"role\":\"assistant\",\"providerID\":\"openai\",\"modelID\":\"gpt-5.4\",\"cost\":3.25}');",
            )
            .expect("populate database");
    }
    let before_content = fs::read(path.path()).expect("read initial database");
    let before_metadata = fs::metadata(path.path()).expect("stat initial database");

    let rows = load_rows(path.path().to_str().unwrap()).expect("load read-only database");
    assert_eq!(
        rows.iter()
            .find(|row| row.session_id == "s1")
            .unwrap()
            .message_date,
        Some(1_700_000_000_001)
    );
    assert_eq!(
        rows.iter()
            .find(|row| row.session_id == "s2")
            .unwrap()
            .message_date,
        None
    );
    let catalog = load_embedded_catalog().expect("embedded catalog");
    let _ = aggregate(&rows, &catalog, &std::collections::HashMap::new());

    let after_content = fs::read(path.path()).expect("read final database");
    let after_metadata = fs::metadata(path.path()).expect("stat final database");
    assert_eq!(before_content, after_content);
    assert_eq!(before_metadata.len(), after_metadata.len());
    assert_eq!(
        before_metadata.modified().unwrap(),
        after_metadata.modified().unwrap()
    );
}

#[test]
fn pricing_loads_the_embedded_official_catalog() {
    let catalog: PricingCatalog = load_embedded_catalog().expect("embedded pricing catalog");

    assert_eq!(catalog.version, 1);
    assert_eq!(catalog.source_version, "official-list-prices-2026-09-23");
    assert_eq!(catalog.rates.len(), 21);
    assert!(catalog.rates.iter().all(|entry| entry.source == "official"));
}

#[test]
fn pricing_rejects_invalid_json() {
    assert!(validate_catalog("not JSON").is_err());
}

#[test]
fn pricing_rejects_unknown_fields() {
    let catalog = catalog_with_rates(
        r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture","unexpected":true}"#,
    );

    assert!(validate_catalog(&catalog).is_err());
}

#[test]
fn pricing_rejects_empty_rates() {
    let catalog = r#"{"version":1,"generatedAt":"2026-09-23T12:00:00Z","sourceVersion":"fixture-1","rates":[]}"#;

    assert!(validate_catalog(catalog).is_err());
}

#[test]
fn pricing_rejects_missing_and_empty_required_fields() {
    let cases = [
        (
            "missing provider",
            r#"{"model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
        ),
        (
            "empty provider",
            r#"{"provider":"  ","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
        ),
        (
            "missing model",
            r#"{"provider":"openai","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
        ),
        (
            "empty model",
            r#"{"provider":"openai","model":"","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
        ),
        (
            "missing source",
            r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0}"#,
        ),
        (
            "empty source",
            r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":""}"#,
        ),
    ];

    for (name, rate_json) in cases {
        assert!(
            validate_catalog(&catalog_with_rates(rate_json)).is_err(),
            "case should be rejected: {name}"
        );
    }

    for source_version in [
        r#"{"version":1,"generatedAt":"2026-09-23T12:00:00Z","rates":[]}"#,
        r#"{"version":1,"generatedAt":"2026-09-23T12:00:00Z","sourceVersion":"  ","rates":[]}"#,
    ] {
        assert!(validate_catalog(source_version).is_err());
    }
}

#[test]
fn pricing_rejects_non_utc_dates() {
    let effective_from = catalog_with_rates(
        r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T01:00:00+01:00","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
    );
    let generated_at = r#"{"version":1,"generatedAt":"2026-09-23T12:00:00+01:00","sourceVersion":"fixture-1","rates":[]}"#;

    assert!(validate_catalog(&effective_from).is_err());
    assert!(validate_catalog(generated_at).is_err());
}

#[test]
fn pricing_rejects_non_finite_values() {
    let catalog = catalog_with_rates(
        r#"{"provider":"openai","model":"gpt","effectiveFrom":"2026-01-01T00:00:00Z","input":1e999,"output":2,"cacheRead":0,"cacheWrite":0,"source":"fixture"}"#,
    );

    assert!(validate_catalog(&catalog).is_err());
}

#[test]
fn pricing_official_catalog_contains_expected_providers_and_luna_rate() {
    let catalog = load_embedded_catalog().expect("embedded pricing catalog");
    let providers: HashSet<&str> = catalog
        .rates
        .iter()
        .map(|entry| entry.provider.as_str())
        .collect();

    assert!(providers.contains("openai"));
    assert!(providers.contains("anthropic"));
    assert!(providers.contains("google"));
    assert!(providers.contains("mistral"));
    assert!(providers.contains("deepseek"));
    assert!(!providers.contains("local"));

    let luna = catalog
        .rates
        .iter()
        .find(|entry| entry.provider == "openai" && entry.model == "gpt-5.6-luna")
        .expect("gpt-5.6-luna rate");
    assert_eq!(luna.effective_from, "2026-09-11T00:00:00Z");
    assert_eq!(luna.input, 0.2);
    assert_eq!(luna.cache_read, 0.02);
    assert_eq!(luna.cache_write, 0.25);
    assert_eq!(luna.output, 1.2);
}

#[test]
fn pricing_cli_rejects_missing_and_invalid_files() {
    let path = unique_temp_path("invalid-pricing");
    let cli = env!("CARGO_BIN_EXE_validate_pricing");

    let missing = Command::new(cli)
        .arg(path.path())
        .output()
        .expect("run validator");
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("cannot read pricing catalog"));

    fs::write(path.path(), "not JSON").expect("write invalid catalog");
    let invalid = Command::new(cli)
        .arg(path.path())
        .output()
        .expect("run validator");
    assert!(!invalid.status.success());
    assert!(String::from_utf8_lossy(&invalid.stderr).contains("invalid pricing catalog"));

    fs::write(path.path(), "").expect("write empty catalog");
    let empty = Command::new(cli)
        .arg(path.path())
        .output()
        .expect("run validator");
    assert!(!empty.status.success());
    assert!(String::from_utf8_lossy(&empty.stderr).contains("invalid pricing catalog"));
}

#[test]
fn pricing_cli_accepts_valid_file() {
    let path = unique_temp_path("valid-pricing");
    let cli = env!("CARGO_BIN_EXE_validate_pricing");
    let embedded = include_str!("../catalog/pricing.json");

    fs::write(path.path(), embedded).expect("write valid catalog");
    let output = Command::new(cli)
        .arg(path.path())
        .output()
        .expect("run validator");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("pricing catalog is valid"));
}

#[test]
fn pricing_cli_rejects_extra_arguments() {
    let path = unique_temp_path("extra-argument");
    fs::write(path.path(), include_str!("../catalog/pricing.json")).expect("write valid catalog");
    let output = Command::new(env!("CARGO_BIN_EXE_validate_pricing"))
        .args([path.path().to_str().unwrap(), "unexpected"])
        .output()
        .expect("run validator");

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("usage: validate_pricing"));
}

#[test]
fn pricing_cli_rejects_checked_in_invalid_fixture() {
    let path = unique_temp_path("invalid-fixture");
    fs::write(path.path(), include_str!("fixtures/pricing-invalid.json"))
        .expect("write invalid fixture");
    let output = Command::new(env!("CARGO_BIN_EXE_validate_pricing"))
        .arg(path.path())
        .output()
        .expect("run validator");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("must be finite and non-negative"));
}
