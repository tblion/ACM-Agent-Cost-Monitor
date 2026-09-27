use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use opencode_costs_viewer_lib::aggregate::RawRow;
use opencode_costs_viewer_lib::application::settings_service::WatcherController;
use opencode_costs_viewer_lib::application::{data_service, pricing_service, settings_service};
use opencode_costs_viewer_lib::cost::Rate;
use opencode_costs_viewer_lib::model::{RateEntry, Settings, Tokens};
use opencode_costs_viewer_lib::pricing::{PricingCatalog, PricingRate};
use opencode_costs_viewer_lib::settings;

static NEXT_TEMPORARY_PATH: AtomicU64 = AtomicU64::new(0);

fn temporary_path(label: &str, extension: &str) -> PathBuf {
    let id = NEXT_TEMPORARY_PATH.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "ocv-application-{label}-{}-{id}{extension}",
        std::process::id()
    ))
}

fn temporary_database(label: &str) -> PathBuf {
    let path = temporary_path(label, ".db");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, parent_id TEXT, time_created INTEGER NOT NULL);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
             INSERT INTO session VALUES ('session-1', '/isolated/project', 'Service test', NULL, 1800000000000);
             INSERT INTO message VALUES ('message-1', 'session-1', 1800000000000, 1800000000001, '{\"role\":\"assistant\",\"providerID\":\"openai\",\"modelID\":\"gpt-5.6-luna\",\"cost\":99,\"tokens\":{\"input\":1000000,\"output\":2000000,\"cache\":{\"read\":0,\"write\":0},\"reasoning\":0}}');",
        )
        .unwrap();
    drop(connection);
    path
}

fn catalog() -> PricingCatalog {
    PricingCatalog {
        version: 1,
        generated_at: "2026-01-01T00:00:00Z".into(),
        source_version: "test".into(),
        rates: vec![PricingRate {
            provider: "provider".into(),
            model: "model".into(),
            effective_from: "2020-01-01T00:00:00Z".into(),
            input: 1.0,
            output: 2.0,
            cache_read: 0.0,
            cache_write: 0.0,
            source: "test".into(),
        }],
    }
}

fn row(message_date: Option<i64>, tokens: Option<Tokens>) -> RawRow {
    RawRow {
        message_id: "message".into(),
        project: "project".into(),
        session_id: "session".into(),
        title: "title".into(),
        parent_id: None,
        date: 1,
        message_date,
        provider: "provider".into(),
        model: "model".into(),
        stored_cost: 3.0,
        tokens,
    }
}

fn linear_rates_for_rows(
    rows: &[RawRow],
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Vec<RateEntry> {
    let mut entries = Vec::new();
    for row in rows {
        if row.tokens.as_ref().is_none_or(|tokens| !tokens.is_valid()) {
            continue;
        }
        let Some(resolved) =
            opencode_costs_viewer_lib::aggregate::resolve_rate_detail(row, catalog, overrides)
        else {
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
                opencode_costs_viewer_lib::aggregate::RateSource::Configured => "configured".into(),
                opencode_costs_viewer_lib::aggregate::RateSource::Catalog => "catalog".into(),
            },
            effective_from: resolved.effective_from,
        };
        if !entries.iter().any(|existing: &RateEntry| {
            existing.provider == entry.provider
                && existing.model == entry.model
                && existing.input == entry.input
                && existing.output == entry.output
                && existing.cache_read == entry.cache_read
                && existing.cache_write == entry.cache_write
                && existing.source == entry.source
                && existing.effective_from == entry.effective_from
        }) {
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

#[test]
fn settings_service_resolves_explicit_paths_without_tauri() {
    let config_path =
        std::env::temp_dir().join(format!("ocv-settings-service-{}.jsonc", std::process::id()));
    fs::write(&config_path, "{}").unwrap();
    let settings = Settings {
        db_path: Some("/tmp/custom.db".into()),
        config_path: Some(config_path.to_string_lossy().into_owned()),
        ..Settings::default()
    };

    let paths = settings_service::resolve_paths(&settings);

    assert_eq!(paths.db, "/tmp/custom.db");
    assert_eq!(paths.config, config_path.to_string_lossy());
    let _ = fs::remove_file(config_path);
}

#[test]
fn data_service_diagnostics_counts_missing_dimensions_independently() {
    let rows = vec![row(None, Some(Tokens::default())), row(Some(1), None)];
    let mut rates = HashMap::new();
    rates.insert(("provider".into(), "model".into()), Rate::default());

    let diagnostics = data_service::diagnostics(&rows, &catalog(), &rates);

    assert_eq!(diagnostics.missing_dates, 1);
    assert_eq!(diagnostics.missing_tokens, 1);
    assert_eq!(diagnostics.recalculable_messages, 1);
}

#[test]
fn data_service_compute_reports_database_errors_without_writing_a_database() {
    let config =
        std::env::temp_dir().join(format!("ocv-compute-config-{}.jsonc", std::process::id()));
    fs::write(&config, "{}").unwrap();

    let error = data_service::compute(Path::new("/missing/opencode.db"), &config)
        .expect_err("missing database must fail");

    assert_eq!(error.code(), "database");
    let _ = fs::remove_file(config);
}

#[test]
fn data_service_recalculate_reports_database_errors_without_writing_a_database() {
    let config = std::env::temp_dir().join(format!(
        "ocv-recalculate-config-{}.jsonc",
        std::process::id()
    ));
    fs::write(&config, "{}").unwrap();

    let error = data_service::recalculate(Path::new("/missing/opencode.db"), &config)
        .expect_err("missing database must fail");

    assert_eq!(error.code(), "database");
    let _ = fs::remove_file(config);
}

#[test]
fn data_service_compute_succeeds_with_an_isolated_sqlite_fixture() {
    let database = temporary_database("compute");
    let config = temporary_path("compute-config", ".jsonc");
    fs::write(&config, "{}").unwrap();

    let sessions = data_service::compute(&database, &config).unwrap();

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "session-1");
    assert!(sessions[0].cost > 0.0);
    let _ = fs::remove_file(database);
    let _ = fs::remove_file(config);
}

#[test]
fn data_service_recalculate_returns_sessions_and_diagnostics_from_an_isolated_fixture() {
    let database = temporary_database("recalculate");
    let config = temporary_path("recalculate-config", ".jsonc");
    fs::write(&config, "{}").unwrap();

    let result = data_service::recalculate(&database, &config).unwrap();

    assert_eq!(result.sessions.len(), 1);
    assert_eq!(result.sessions[0].id, "session-1");
    assert_eq!(result.diagnostics.recalculable_messages, 1);
    assert_eq!(result.diagnostics.missing_dates, 0);
    assert_eq!(result.diagnostics.missing_tokens, 0);
    assert_eq!(result.diagnostics.missing_rates, 0);
    let _ = fs::remove_file(database);
    let _ = fs::remove_file(config);
}

#[test]
fn pricing_service_returns_only_rates_applied_to_rows() {
    let entries = pricing_service::rates_for_rows(
        &[row(Some(1_700_000_000_000), Some(Tokens::default()))],
        &catalog(),
        &HashMap::new(),
    );

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].provider, "provider");
    assert_eq!(entries[0].source, "catalog");
}

#[test]
fn pricing_service_preserves_large_result_cardinality_order_and_values() {
    let mut overrides = HashMap::new();
    for index in 0..17 {
        overrides.insert(
            (format!("provider-{index}"), "model".into()),
            Rate {
                input: index as f64 + 1.0,
                output: index as f64 + 2.0,
                cache_read: index as f64,
                cache_write: index as f64 + 0.5,
            },
        );
    }
    let rows = (0..6_000)
        .map(|index| {
            let mut current = row(Some(1_700_000_000_000), Some(Tokens::default()));
            current.provider = format!("provider-{}", index % 17);
            current
        })
        .collect::<Vec<_>>();
    let expected = linear_rates_for_rows(&rows, &catalog(), &overrides);

    let actual = pricing_service::rates_for_rows(&rows, &catalog(), &overrides);

    assert_eq!(actual.len(), 17);
    assert_eq!(actual.len(), expected.len());
    for (actual, expected) in actual.iter().zip(expected.iter()) {
        assert_eq!(actual.provider, expected.provider);
        assert_eq!(actual.model, expected.model);
        assert_eq!(actual.input, expected.input);
        assert_eq!(actual.output, expected.output);
        assert_eq!(actual.cache_read, expected.cache_read);
        assert_eq!(actual.cache_write, expected.cache_write);
        assert_eq!(actual.source, expected.source);
        assert_eq!(actual.effective_from, expected.effective_from);
    }
}

struct TestWatcher {
    active: Option<PathBuf>,
    starts: usize,
}

impl settings_service::WatcherController for TestWatcher {
    fn active_path(&self) -> Option<&Path> {
        self.active.as_deref()
    }

    fn start_or_restart(&mut self, path: &Path) -> Result<(), String> {
        if !path.exists() {
            return Err("database missing".into());
        }
        self.active = Some(path.to_path_buf());
        self.starts += 1;
        Ok(())
    }

    fn stop(&mut self) {
        self.active = None;
    }
}

#[test]
fn settings_service_transaction_rolls_back_when_watcher_activation_fails() {
    let directory =
        std::env::temp_dir().join(format!("ocv-settings-service-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    settings::save(&directory, &Settings::default()).unwrap();
    let next = Settings {
        live: true,
        db_path: Some(directory.join("missing.db").to_string_lossy().into_owned()),
        ..Settings::default()
    };
    let mut watcher = TestWatcher {
        active: None,
        starts: 0,
    };
    let mut runtime = settings_service::SettingsRuntimeState::default();

    let error =
        settings_service::save_settings_with_runtime(&directory, &mut watcher, &next, &mut runtime)
            .expect_err("watcher activation must fail");

    assert_eq!(error.code(), "watcher");
    assert!(!settings::load(&directory).unwrap().live);
    assert!(watcher.active_path().is_none());
    assert!(!runtime.live_active);
    assert_eq!(runtime.watcher_error.as_ref().unwrap().code(), "watcher");
    let _ = fs::remove_dir_all(directory);
}

#[test]
fn settings_service_save_persists_and_synchronizes_runtime_with_a_fake_watcher() {
    let directory = std::env::temp_dir().join(format!(
        "ocv-settings-service-success-{}-{}",
        std::process::id(),
        NEXT_TEMPORARY_PATH.fetch_add(1, Ordering::Relaxed)
    ));
    let database = directory.join("isolated.db");
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    fs::write(&database, b"isolated test database").unwrap();
    settings::save(&directory, &Settings::default()).unwrap();
    let next = Settings {
        live: true,
        db_path: Some(database.to_string_lossy().into_owned()),
        ..Settings::default()
    };
    let mut watcher = TestWatcher {
        active: None,
        starts: 0,
    };
    let mut runtime = settings_service::SettingsRuntimeState::default();

    let outcome =
        settings_service::save_settings_with_runtime(&directory, &mut watcher, &next, &mut runtime)
            .unwrap();

    assert!(settings::load(&directory).unwrap().live);
    assert_eq!(watcher.active_path(), Some(database.as_path()));
    assert_eq!(watcher.starts, 1);
    assert!(runtime.live_active);
    assert!(runtime.watcher_error.is_none());
    assert!(outcome.live_active);
    assert!(outcome.diagnostic.is_none());
    let _ = fs::remove_dir_all(directory);
}
