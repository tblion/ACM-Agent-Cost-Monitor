use crate::config;
use crate::db;
use crate::error::{AppError, ErrorCategory};
use crate::model::{ResolvedPaths, Settings};
use crate::settings;
use std::path::Path;

pub fn resolve_paths(settings: &Settings) -> ResolvedPaths {
    let db = settings
        .db_path
        .clone()
        .unwrap_or_else(|| db::default_db_path().to_string_lossy().into_owned());
    let config = config::resolve_config_path(settings.config_path.as_deref())
        .to_string_lossy()
        .into_owned();
    ResolvedPaths { db, config }
}

pub fn load_for_startup(config_dir: &Path) -> (Settings, Option<AppError>) {
    let (settings, diagnostic) = settings::load_for_status(config_dir);
    (settings, diagnostic.map(settings_load_error))
}

pub fn load_for_commands(config_dir: &Path) -> Result<Settings, AppError> {
    settings::load(&config_dir.to_path_buf()).map_err(settings_load_error)
}

fn settings_load_error(message: String) -> AppError {
    let category = if message.starts_with("Erreur de configuration: lecture de")
        || message.starts_with("Erreur de configuration: JSON invalide")
    {
        ErrorCategory::Configuration
    } else {
        ErrorCategory::Settings
    };
    AppError::new(category, message)
}

pub trait WatcherController {
    fn active_path(&self) -> Option<&Path>;
    fn start_or_restart(&mut self, path: &Path) -> Result<(), String>;
    fn stop(&mut self);
}

#[derive(Debug, Clone, Default)]
pub struct SettingsRuntimeState {
    pub settings_error: Option<AppError>,
    pub watcher_error: Option<AppError>,
    pub live_active: bool,
}

#[derive(Debug, Clone)]
pub struct SettingsSaveOutcome {
    pub live_active: bool,
    pub diagnostic: Option<AppError>,
}

fn synchronize_watcher<C: WatcherController>(
    controller: &mut C,
    settings: &Settings,
) -> Result<(), String> {
    if settings.live {
        let database_path = resolve_paths(settings).db;
        controller.start_or_restart(Path::new(&database_path))
    } else {
        controller.stop();
        Ok(())
    }
}

fn restore_watcher<C: WatcherController>(
    controller: &mut C,
    previous_path: Option<&Path>,
) -> Result<(), String> {
    if let Some(path) = previous_path {
        controller.start_or_restart(path)
    } else {
        controller.stop();
        Ok(())
    }
}

pub fn save_settings_transactional<C: WatcherController>(
    config_dir: &Path,
    controller: &mut C,
    next: &Settings,
) -> Result<(), AppError> {
    let (previous, previous_invalid) = match settings::load(&config_dir.to_path_buf()) {
        Ok(settings) => (settings, false),
        Err(_) => (Settings::default(), true),
    };
    let previous_file = settings::snapshot(config_dir)
        .map_err(|message| AppError::new(ErrorCategory::Settings, message))?;
    let previous_watcher_path = controller.active_path().map(Path::to_path_buf);
    settings::validate(next)
        .map_err(|message| AppError::new(ErrorCategory::InvalidInput, message))?;
    let watcher_changed = previous_invalid
        || previous.live != next.live
        || previous.db_path != next.db_path
        || (next.live && controller.active_path().is_none());

    if let Err(message) = settings::save(&config_dir.to_path_buf(), next) {
        let error = AppError::new(ErrorCategory::Settings, message);
        if let Err(rollback) = settings::restore_snapshot(config_dir, previous_file.as_deref())
            .map_err(|message| AppError::new(ErrorCategory::Settings, message))
        {
            return Err(
                error.with_context(format!("restauration des réglages impossible: {rollback}"))
            );
        }
        return Err(error);
    }

    if watcher_changed {
        if let Err(message) = synchronize_watcher(controller, next) {
            let file_rollback = settings::restore_snapshot(config_dir, previous_file.as_deref())
                .map_err(|error| AppError::new(ErrorCategory::Settings, error));
            let watcher_rollback = restore_watcher(controller, previous_watcher_path.as_deref())
                .map_err(|error| AppError::new(ErrorCategory::Watcher, error));
            let error = AppError::new(ErrorCategory::Watcher, message);
            return match (file_rollback, watcher_rollback) {
                (Ok(()), Ok(())) => Err(error),
                (Err(file_error), Ok(())) => Err(error.with_context(format!(
                    "restauration des réglages impossible: {file_error}"
                ))),
                (Ok(()), Err(watcher_error)) => Err(error.with_context(format!(
                    "restauration du watcher impossible: {watcher_error}"
                ))),
                (Err(file_error), Err(watcher_error)) => Err(error.with_context(format!(
                    "restaurations impossibles: réglages: {file_error}; watcher: {watcher_error}"
                ))),
            };
        }
    }
    Ok(())
}

pub fn save_settings_with_runtime<C: WatcherController>(
    config_dir: &Path,
    controller: &mut C,
    next: &Settings,
    runtime: &mut SettingsRuntimeState,
) -> Result<SettingsSaveOutcome, AppError> {
    let result = save_settings_transactional(config_dir, controller, next);
    runtime.live_active = controller.active_path().is_some();

    match &result {
        Ok(()) => {
            runtime.settings_error = None;
            runtime.watcher_error = None;
        }
        Err(error) if error.code() == ErrorCategory::Watcher.code() => {
            runtime.watcher_error = Some(error.clone());
        }
        Err(_) => {}
    }

    result.map(|()| SettingsSaveOutcome {
        live_active: runtime.live_active,
        diagnostic: runtime
            .settings_error
            .clone()
            .or_else(|| runtime.watcher_error.clone()),
    })
}
