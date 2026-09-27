use opencode_costs_viewer_lib::application::data_service;
use opencode_costs_viewer_lib::commands;
use opencode_costs_viewer_lib::commands::{AppRuntimeState, AppState};
use opencode_costs_viewer_lib::error::{AppError, ErrorCategory};
use opencode_costs_viewer_lib::model::{Settings, SettingsResponse};
use opencode_costs_viewer_lib::settings;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

#[test]
fn app_errors_serialize_stable_codes_and_technical_messages() {
    let categories = [
        (ErrorCategory::Database, "database"),
        (ErrorCategory::Configuration, "configuration"),
        (ErrorCategory::Settings, "settings"),
        (ErrorCategory::Pricing, "pricing"),
        (ErrorCategory::Watcher, "watcher"),
        (ErrorCategory::Export, "export"),
        (ErrorCategory::InvalidInput, "invalid_input"),
    ];

    for (category, code) in categories {
        let error = AppError::new(category, "technical failure");
        let json = serde_json::to_value(error).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "code": code,
                "message": "technical failure"
            })
        );
    }
}

#[test]
fn app_errors_preserve_context_without_exposing_paths() {
    let error = AppError::new(ErrorCategory::Database, "query failed")
        .with_context("unable to load session data");

    assert_eq!(error.code(), "database");
    assert_eq!(error.message(), "unable to load session data: query failed");
    assert!(!error.message().contains("/Users/"));
}

#[test]
fn priority_commands_propagate_the_database_category() {
    let error = data_service::compute(
        Path::new("/definitely/missing/opencode.db"),
        Path::new("/missing/config.jsonc"),
    )
    .expect_err("missing database must fail");

    assert_eq!(error.code(), "database");
}

#[test]
fn settings_response_keeps_its_public_shape_with_structured_diagnostic() {
    let response = SettingsResponse {
        settings: Settings::default(),
        diagnostic: Some(AppError::new(ErrorCategory::Settings, "invalid settings")),
        live_active: false,
    };
    let json = serde_json::to_value(response).unwrap();

    assert!(json.get("settings").is_some());
    assert_eq!(json["diagnostic"]["code"], "settings");
    assert_eq!(json["diagnostic"]["message"], "invalid settings");
    assert_eq!(json["liveActive"], false);
}

#[test]
fn legacy_get_settings_keeps_returning_settings_while_status_keeps_diagnostic() {
    let directory = test_directory("settings-contract");
    std::fs::write(directory.join("settings.json"), r#"{"theme":"invalid"}"#).unwrap();
    let app = tauri::test::mock_app();
    app.manage(state(directory.clone()));

    let legacy = commands::get_settings(app.state());
    let status = commands::get_settings_status(app.state()).unwrap();

    assert_eq!(legacy.theme, "system");
    assert_eq!(status.settings.theme, "system");
    assert_eq!(status.diagnostic.as_ref().unwrap().code(), "settings");
    assert!(!serde_json::to_string(&status)
        .unwrap()
        .contains(directory.to_string_lossy().as_ref()));
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn invalid_settings_are_not_replaced_by_defaults_for_real_commands() {
    let directory = test_directory("invalid-real-settings");
    std::fs::write(directory.join("settings.json"), r#"{"theme":"invalid"}"#).unwrap();

    for command in ["data", "rates", "recalculate", "audit", "runtime"] {
        let app = tauri::test::mock_app();
        app.manage(state(directory.clone()));
        let error = match command {
            "data" => commands::get_data(app.state()).map(|_| ()),
            "rates" => commands::get_rates(app.state()).map(|_| ()),
            "recalculate" => commands::recalculate_data(app.state()).map(|_| ()),
            "audit" => commands::get_audit_report(app.state()).map(|_| ()),
            "runtime" => commands::get_runtime_metrics(app.state(), false).map(|_| ()),
            _ => unreachable!(),
        }
        .expect_err("invalid real settings must fail");
        assert_serialized_code(&error, "settings");
    }

    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn malformed_settings_json_is_configuration_error() {
    let directory = test_directory("malformed-settings");
    std::fs::write(directory.join("settings.json"), "{ malformed").unwrap();
    let app = tauri::test::mock_app();
    app.manage(state(directory.clone()));

    let error = commands::get_data(app.state()).expect_err("malformed settings must fail");

    assert_serialized_code(&error, "configuration");
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn cost_summary_preserves_database_errors() {
    let directory = test_directory("cost-summary-database");
    let missing_database = directory.join("missing.db");
    settings::save(
        &directory,
        &Settings {
            db_path: Some(missing_database.to_string_lossy().into_owned()),
            ..Settings::default()
        },
    )
    .unwrap();
    let app = tauri::test::mock_app();
    app.manage(state(directory.clone()));

    let error = commands::get_cost_summary(app.state()).expect_err("missing database must fail");

    assert_serialized_code(&error, "database");
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn structured_error_messages_never_expose_absolute_paths() {
    let path = std::env::temp_dir().join("private-settings.json");
    let error = AppError::new(
        ErrorCategory::Configuration,
        format!("settings file could not be read: {}", path.display()),
    );
    let json = serde_json::to_value(error).unwrap();

    assert!(!json["message"]
        .as_str()
        .unwrap()
        .contains(path.to_string_lossy().as_ref()));
    assert!(!json["message"].as_str().unwrap().contains("/tmp/"));
}

#[test]
fn save_settings_propagates_invalid_input_as_invalid_input() {
    let app = tauri::test::mock_app();
    let directory = test_directory("save-invalid");
    app.manage(state(directory.clone()));
    let invalid = Settings {
        theme: "sepia".into(),
        ..Settings::default()
    };

    let error = commands::save_settings(app.handle().clone(), app.state(), invalid)
        .expect_err("invalid settings must be rejected");

    assert_serialized_code(&error, "invalid_input");
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn save_settings_propagates_watcher_failures_as_watcher() {
    let app = tauri::test::mock_app();
    let directory = test_directory("save-watcher");
    app.manage(state(directory.clone()));
    let settings = Settings {
        live: true,
        db_path: Some(directory.join("missing.db").to_string_lossy().into_owned()),
        ..Settings::default()
    };

    let error = commands::save_settings(app.handle().clone(), app.state(), settings)
        .expect_err("watcher activation must fail for a missing database");

    assert_serialized_code(&error, "watcher");
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn recalculate_data_propagates_database_and_configuration_failures() {
    let database_directory = test_directory("recalculate-database");
    let database_error = command_error_for_settings(
        &database_directory,
        Settings {
            db_path: Some(
                database_directory
                    .join("missing.db")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..Settings::default()
        },
        |state| commands::recalculate_data(state),
    );
    assert_serialized_code(&database_error, "database");

    let configuration_directory = test_directory("recalculate-configuration");
    let invalid_config = configuration_directory.join("config.jsonc");
    std::fs::write(&invalid_config, "{ invalid").unwrap();
    let configuration_error = command_error_for_settings(
        &configuration_directory,
        Settings {
            config_path: Some(invalid_config.to_string_lossy().into_owned()),
            ..Settings::default()
        },
        |state| commands::recalculate_data(state),
    );
    assert_serialized_code(&configuration_error, "configuration");

    let _ = std::fs::remove_dir_all(database_directory);
    let _ = std::fs::remove_dir_all(configuration_directory);
}

#[test]
fn get_audit_report_propagates_database_and_configuration_failures() {
    let database_directory = test_directory("audit-database");
    let database_error = command_error_for_settings(
        &database_directory,
        Settings {
            db_path: Some(
                database_directory
                    .join("missing.db")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..Settings::default()
        },
        |state| commands::get_audit_report(state),
    );
    assert_serialized_code(&database_error, "database");

    let configuration_directory = test_directory("audit-configuration");
    let invalid_config = configuration_directory.join("config.jsonc");
    std::fs::write(&invalid_config, "{ invalid").unwrap();
    let configuration_error = command_error_for_settings(
        &configuration_directory,
        Settings {
            config_path: Some(invalid_config.to_string_lossy().into_owned()),
            ..Settings::default()
        },
        |state| commands::get_audit_report(state),
    );
    assert_serialized_code(&configuration_error, "configuration");

    let _ = std::fs::remove_dir_all(database_directory);
    let _ = std::fs::remove_dir_all(configuration_directory);
}

fn assert_serialized_code(error: &AppError, expected: &str) {
    assert_eq!(serde_json::to_value(error).unwrap()["code"], expected);
}

fn command_error_for_settings<T: std::fmt::Debug>(
    directory: &Path,
    next: Settings,
    command: impl FnOnce(tauri::State<'_, AppState>) -> Result<T, AppError>,
) -> AppError {
    settings::save(&directory.to_path_buf(), &next).unwrap();
    let app = tauri::test::mock_app();
    app.manage(state(directory.to_path_buf()));
    command(app.state()).expect_err("command must fail")
}

fn state(config_dir: PathBuf) -> AppState {
    AppState {
        config_dir,
        runtime: Mutex::new(AppRuntimeState {
            watcher: opencode_costs_viewer_lib::watcher::WatcherService::default(),
            settings_error: None,
            watcher_error: None,
            live_active: false,
        }),
    }
}

fn test_directory(name: &str) -> PathBuf {
    let id = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir().join(format!("ocv-error-{name}-{id}"));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}
