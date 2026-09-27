use crate::application::{audit_service, data_service, pricing_service, settings_service};
use crate::error::{AppError, ErrorCategory};
use crate::model::{
    AuditReport, CostSummary, RateEntry, RecalculationResult, ResolvedPaths, RuntimeMetrics,
    SessionRecord, Settings, SettingsResponse,
};
use crate::watcher::WatcherService;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime, State};

pub struct AppState {
    pub config_dir: PathBuf,
    pub runtime: Mutex<AppRuntimeState>,
}

pub struct AppRuntimeState {
    pub watcher: WatcherService,
    pub settings_error: Option<AppError>,
    pub watcher_error: Option<AppError>,
    pub live_active: bool,
}

fn effective_settings(state: &AppState) -> Result<Settings, AppError> {
    settings_service::load_for_commands(&state.config_dir)
}

fn effective_settings_status(state: &AppState) -> Settings {
    let (settings, diagnostic) = settings_service::load_for_startup(&state.config_dir);
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.settings_error = diagnostic;
    }
    settings
}

struct TauriWatcherController<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    watcher: &'a mut WatcherService,
}

impl<R: Runtime> settings_service::WatcherController for TauriWatcherController<'_, R> {
    fn active_path(&self) -> Option<&Path> {
        self.watcher.active_path()
    }

    fn start_or_restart(&mut self, path: &Path) -> Result<(), String> {
        self.watcher.start_or_restart(self.app.clone(), path)
    }

    fn stop(&mut self) {
        self.watcher.stop();
    }
}

#[tauri::command]
pub fn save_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<AppState>,
    s: Settings,
) -> Result<(), AppError> {
    let mut runtime_state = state
        .runtime
        .lock()
        .map_err(|_| AppError::new(ErrorCategory::Watcher, "Etat runtime verrouillé"))?;
    let mut runtime = settings_service::SettingsRuntimeState {
        settings_error: runtime_state.settings_error.clone(),
        watcher_error: runtime_state.watcher_error.clone(),
        live_active: runtime_state.live_active,
    };
    let mut controller = TauriWatcherController {
        app: &app,
        watcher: &mut runtime_state.watcher,
    };
    let result = settings_service::save_settings_with_runtime(
        &state.config_dir,
        &mut controller,
        &s,
        &mut runtime,
    );
    runtime_state.live_active = runtime.live_active;
    runtime_state.settings_error = runtime.settings_error;
    runtime_state.watcher_error = runtime.watcher_error;
    result.map(|_| ())
}

#[tauri::command]
pub fn get_data(state: State<AppState>) -> Result<Vec<SessionRecord>, AppError> {
    let paths = settings_service::resolve_paths(&effective_settings(&state)?);
    data_service::compute(Path::new(&paths.db), Path::new(&paths.config))
}

#[tauri::command]
pub fn get_cost_summary(state: State<AppState>) -> Result<Vec<CostSummary>, AppError> {
    let paths = settings_service::resolve_paths(&effective_settings(&state)?);
    data_service::compute_cost_summary(Path::new(&paths.db), Path::new(&paths.config))
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    effective_settings_status(&state)
}

#[tauri::command]
pub fn get_settings_status(state: State<AppState>) -> Result<SettingsResponse, AppError> {
    let (settings, load_diagnostic) = settings_service::load_for_startup(&state.config_dir);
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| AppError::new(ErrorCategory::Watcher, "Etat runtime verrouillé"))?;
    runtime.settings_error = load_diagnostic;
    let diagnostic = runtime
        .settings_error
        .clone()
        .or_else(|| runtime.watcher_error.clone());
    Ok(SettingsResponse {
        settings,
        diagnostic,
        live_active: runtime.live_active,
    })
}

#[tauri::command]
pub fn get_runtime_metrics(
    state: State<AppState>,
    include_database_size: bool,
) -> Result<RuntimeMetrics, AppError> {
    let settings = effective_settings(&state)?;
    let database =
        include_database_size.then(|| PathBuf::from(settings_service::resolve_paths(&settings).db));
    Ok(data_service::runtime_metrics(database.as_deref()))
}

#[tauri::command]
pub fn get_resolved_paths(state: State<AppState>) -> Result<ResolvedPaths, AppError> {
    Ok(settings_service::resolve_paths(&effective_settings_status(
        &state,
    )))
}

#[tauri::command]
pub fn get_rates(state: State<AppState>) -> Result<Vec<RateEntry>, AppError> {
    let paths = settings_service::resolve_paths(&effective_settings(&state)?);
    pricing_service::rates_for_paths(Path::new(&paths.db), Path::new(&paths.config))
}

#[tauri::command]
pub fn get_catalog_status() -> Result<crate::model::CatalogStatus, AppError> {
    pricing_service::catalog_status()
}

#[tauri::command]
pub fn recalculate_data(state: State<AppState>) -> Result<RecalculationResult, AppError> {
    let paths = settings_service::resolve_paths(&effective_settings(&state)?);
    data_service::recalculate(Path::new(&paths.db), Path::new(&paths.config))
}

#[tauri::command]
pub fn get_audit_report(state: State<AppState>) -> Result<AuditReport, AppError> {
    let paths = settings_service::resolve_paths(&effective_settings(&state)?);
    audit_service::build_audit_report_for_paths(Path::new(&paths.db), Path::new(&paths.config))
}

fn export_kind(suggested_name: &str) -> Result<(&'static str, &'static str), AppError> {
    match Path::new(suggested_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("json") => Ok(("JSON", "json")),
        Some("csv") => Ok(("CSV", "csv")),
        _ => Err(AppError::new(
            ErrorCategory::InvalidInput,
            "Le nom d'export doit se terminer par .json ou .csv",
        )),
    }
}

pub fn write_export_file(path: &Path, content: &str) -> Result<(), AppError> {
    std::fs::write(path, content).map_err(|error| {
        AppError::new(
            ErrorCategory::Export,
            format!("Ecriture de l'export impossible: {error}"),
        )
    })
}

#[tauri::command]
pub async fn export_audit_report(
    app: AppHandle,
    content: String,
    suggested_name: String,
) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let (filter_name, extension) = export_kind(&suggested_name)?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Option<PathBuf>, AppError>>();
    app.dialog()
        .file()
        .set_file_name(suggested_name)
        .add_filter(filter_name, &[extension])
        .save_file(move |res| {
            let path = res
                .map(|file_path| {
                    file_path
                        .into_path()
                        .map_err(|error| AppError::new(ErrorCategory::Export, error.to_string()))
                })
                .transpose();
            let _ = tx.send(path);
        });
    let Some(path) = rx
        .await
        .map_err(|error| AppError::new(ErrorCategory::Export, error.to_string()))??
    else {
        return Ok(None);
    };
    write_export_file(&path, &content)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_path(app: AppHandle) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Option<String>, AppError>>();
    app.dialog().file().pick_file(move |res| {
        let out = res
            .map(|fp| {
                fp.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .transpose()
            .map_err(|error| AppError::new(ErrorCategory::Settings, error.to_string()));
        let _ = tx.send(out);
    });
    rx.await
        .map_err(|error| AppError::new(ErrorCategory::Settings, error.to_string()))?
}
