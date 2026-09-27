pub mod aggregate;
pub mod application;
pub mod audit;
pub mod commands;
pub mod config;
pub mod cost;
pub mod db;
pub mod error;
pub mod jsonc;
pub mod model;
pub mod pricing;
pub mod runtime;
pub mod settings;
pub mod watcher;

use crate::error::{AppError, ErrorCategory};
use crate::model::Settings;
use std::sync::Mutex;
use tauri::Manager;

fn should_start_watcher(settings: &Settings, diagnostic: Option<&AppError>) -> bool {
    diagnostic.is_none() && settings.live
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().expect("config dir");
            let (s, settings_error) = application::settings_service::load_for_startup(&config_dir);
            let mut watcher_service = watcher::WatcherService::default();
            let mut live_active = false;
            let settings_error = settings_error;
            let mut watcher_error = None;
            if should_start_watcher(&s, settings_error.as_ref()) {
                let db = application::settings_service::resolve_paths(&s).db;
                if let Err(error) = watcher_service
                    .start_or_restart(app.handle().clone(), std::path::Path::new(&db))
                {
                    eprintln!("watcher: {error}");
                    watcher_error = Some(AppError::new(ErrorCategory::Watcher, error));
                } else {
                    live_active = true;
                }
            }
            app.manage(commands::AppState {
                config_dir,
                runtime: Mutex::new(commands::AppRuntimeState {
                    watcher: watcher_service,
                    settings_error,
                    watcher_error,
                    live_active,
                }),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_data,
            commands::get_cost_summary,
            commands::get_settings,
            commands::get_settings_status,
            commands::get_runtime_metrics,
            commands::save_settings,
            commands::pick_path,
            commands::get_resolved_paths,
            commands::get_rates,
            commands::get_catalog_status,
            commands::recalculate_data,
            commands::get_audit_report,
            commands::export_audit_report,
        ])
        .run(tauri::generate_context!())
        .expect("erreur lors du lancement de Tauri");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn invalid_startup_settings_are_deferred_without_rewriting_the_file() {
        let dir = std::env::temp_dir().join("ocv-invalid-startup-settings");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let contents = r#"{"live":true,"theme":"invalid"}"#;
        std::fs::write(dir.join("settings.json"), contents).unwrap();

        let (settings, error) = application::settings_service::load_for_startup(&dir);

        assert_eq!(settings.live, true);
        assert!(error.unwrap().message().contains("validation"));
        assert_eq!(
            std::fs::read_to_string(dir.join("settings.json")).unwrap(),
            contents
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_startup_settings_never_start_the_watcher() {
        let settings = Settings {
            live: true,
            ..Settings::default()
        };
        let diagnostic = AppError::new(ErrorCategory::Settings, "invalid settings");

        assert!(!should_start_watcher(&settings, Some(&diagnostic)));
        assert!(should_start_watcher(&settings, None));
    }

    #[test]
    fn runtime_state_serializes_concurrent_command_access() {
        let runtime = Arc::new(Mutex::new(commands::AppRuntimeState {
            watcher: watcher::WatcherService::default(),
            settings_error: None,
            watcher_error: None,
            live_active: false,
        }));
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();

        for _ in 0..2 {
            let runtime = Arc::clone(&runtime);
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                let mut state = runtime.lock().unwrap();
                state.live_active = !state.live_active;
            }));
        }
        barrier.wait();
        for handle in handles {
            handle.join().unwrap();
        }

        assert!(!runtime.lock().unwrap().live_active);
    }
}
