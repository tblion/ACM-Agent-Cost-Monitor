use crate::model::{CustomGroup, Settings};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMPORARY_FILE_ID: AtomicU64 = AtomicU64::new(0);

pub fn load(config_dir: &PathBuf) -> Result<Settings, String> {
    let p = config_dir.join("settings.json");
    let contents = match fs::read_to_string(&p) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Settings::default())
        }
        Err(error) => {
            return Err(format!(
                "Erreur de configuration: lecture de {}: {error}",
                p.display()
            ))
        }
    };
    let value: serde_json::Value = serde_json::from_str(&contents).map_err(|error| {
        format!(
            "Erreur de configuration: JSON invalide dans {}: {error}",
            p.display()
        )
    })?;
    let settings: Settings = serde_json::from_value(value).map_err(|error| {
        format!(
            "Erreur de validation des réglages dans {}: {error}",
            p.display()
        )
    })?;
    validate(&settings)?;
    Ok(settings)
}

pub fn load_for_status(config_dir: &Path) -> (Settings, Option<String>) {
    let path = config_dir.join("settings.json");
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Settings::default(), None)
        }
        Err(error) => {
            return (
                Settings::default(),
                Some(format!(
                    "Erreur de configuration: lecture de {}: {error}",
                    path.display()
                )),
            )
        }
    };
    let value: serde_json::Value = match serde_json::from_str(&contents) {
        Ok(value) => value,
        Err(error) => {
            return (
                Settings::default(),
                Some(format!(
                    "Erreur de configuration: JSON invalide dans {}: {error}",
                    path.display()
                )),
            )
        }
    };
    let Some(object) = value.as_object() else {
        return (
            Settings::default(),
            Some("Erreur de validation des réglages: l'objet racine est invalide".into()),
        );
    };

    let mut settings = Settings::default();
    let mut invalid_fields = Vec::new();
    let known_fields = [
        "dbPath",
        "configPath",
        "live",
        "theme",
        "language",
        "defaultPeriodDays",
        "customGroups",
    ];
    for key in object.keys() {
        if !known_fields.contains(&key.as_str()) {
            invalid_fields.push(key.as_str());
        }
    }
    if let Some(value) = object.get("dbPath") {
        match value {
            serde_json::Value::Null => settings.db_path = None,
            serde_json::Value::String(value) => settings.db_path = Some(value.clone()),
            _ => invalid_fields.push("dbPath"),
        }
    }
    if let Some(value) = object.get("configPath") {
        match value {
            serde_json::Value::Null => settings.config_path = None,
            serde_json::Value::String(value) => settings.config_path = Some(value.clone()),
            _ => invalid_fields.push("configPath"),
        }
    }
    if let Some(value) = object.get("live") {
        if let Some(value) = value.as_bool() {
            settings.live = value;
        } else {
            invalid_fields.push("live");
        }
    }
    if let Some(value) = object.get("theme") {
        if let Some(value) = value
            .as_str()
            .filter(|value| matches!(*value, "system" | "light" | "dark"))
        {
            settings.theme = value.to_string();
        } else {
            invalid_fields.push("theme");
        }
    }
    if let Some(value) = object.get("language") {
        match value {
            serde_json::Value::Null => settings.language = None,
            serde_json::Value::String(value) if matches!(value.as_str(), "fr" | "en") => {
                settings.language = Some(value.clone())
            }
            _ => invalid_fields.push("language"),
        }
    }
    if let Some(value) = object.get("defaultPeriodDays") {
        if let Some(value) = value.as_i64().filter(|value| (1..=3650).contains(value)) {
            settings.default_period_days = value;
        } else {
            invalid_fields.push("defaultPeriodDays");
        }
    }
    if let Some(value) = object.get("customGroups") {
        if let Some(groups) = value.as_array() {
            for group in groups {
                let Some(group) = group.as_object() else {
                    invalid_fields.push("customGroups");
                    continue;
                };
                if group
                    .keys()
                    .any(|key| !matches!(key.as_str(), "name" | "projects"))
                {
                    invalid_fields.push("customGroups");
                }
                let Some(name) = group.get("name").and_then(serde_json::Value::as_str) else {
                    invalid_fields.push("customGroups");
                    continue;
                };
                let Some(projects) = group.get("projects").and_then(serde_json::Value::as_array)
                else {
                    invalid_fields.push("customGroups");
                    continue;
                };
                if name.trim().is_empty()
                    || projects.iter().any(|project| {
                        project
                            .as_str()
                            .is_none_or(|project| project.trim().is_empty())
                    })
                {
                    invalid_fields.push("customGroups");
                    continue;
                }
                settings.custom_groups.push(CustomGroup {
                    name: name.to_string(),
                    projects: projects
                        .iter()
                        .map(|project| project.as_str().unwrap().to_string())
                        .collect(),
                });
            }
        } else {
            invalid_fields.push("customGroups");
        }
    }
    invalid_fields.sort_unstable();
    invalid_fields.dedup();
    let diagnostic = (!invalid_fields.is_empty()).then(|| {
        format!(
            "Erreur de validation des réglages: champs invalides: {}",
            invalid_fields.join(", ")
        )
    });
    (settings, diagnostic)
}

pub(crate) fn validate(settings: &Settings) -> Result<(), String> {
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        return Err(format!(
            "Erreur de validation des réglages: thème inconnu: {}",
            settings.theme
        ));
    }
    if let Some(language) = &settings.language {
        if !matches!(language.as_str(), "fr" | "en") {
            return Err(format!(
                "Erreur de validation des réglages: langue inconnue: {language}"
            ));
        }
    }
    if !(1..=3650).contains(&settings.default_period_days) {
        return Err("Erreur de validation des réglages: defaultPeriodDays doit être compris entre 1 et 3650".into());
    }
    for group in &settings.custom_groups {
        if group.name.trim().is_empty()
            || group
                .projects
                .iter()
                .any(|project| project.trim().is_empty())
        {
            return Err("Erreur de validation des réglages: groupe personnalisé invalide".into());
        }
    }
    Ok(())
}

pub(crate) fn snapshot(config_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    let path = config_dir.join("settings.json");
    match fs::read(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn restore_snapshot(config_dir: &Path, contents: Option<&[u8]>) -> Result<(), String> {
    match contents {
        Some(contents) => write_atomic(config_dir, contents),
        None => match fs::remove_file(config_dir.join("settings.json")) {
            Ok(()) => sync_parent(config_dir),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

pub fn save(config_dir: &PathBuf, s: &Settings) -> Result<(), String> {
    validate(s)?;
    let contents = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(config_dir, &contents)
}

fn write_atomic(config_dir: &Path, contents: &[u8]) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let target = config_dir.join("settings.json");
    let id = TEMPORARY_FILE_ID.fetch_add(1, Ordering::Relaxed);
    let temporary = config_dir.join(format!(".settings.json.{}.{}.tmp", std::process::id(), id));

    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(contents)
            .map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        replace_file(&temporary, &target)?;
        sync_parent(config_dir)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temporary, target).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn replace_file(temporary: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent(config_dir: &Path) -> Result<(), String> {
    File::open(config_dir)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn sync_parent(_config_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join("ocv_settings_test");
        let _ = fs::remove_dir_all(&dir);
        let mut s = Settings::default();
        s.live = true;
        s.db_path = Some("C:/x.db".into());
        s.language = Some("fr".into());
        save(&dir, &s).unwrap();
        let loaded = load(&dir).unwrap();
        assert!(loaded.live);
        assert_eq!(loaded.db_path.as_deref(), Some("C:/x.db"));
        assert_eq!(loaded.language.as_deref(), Some("fr"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tolerant_load_preserves_valid_fields_without_rewriting_invalid_file() {
        let dir = std::env::temp_dir().join("ocv_settings_tolerant_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let original = r#"{
            "dbPath": "/data/opencode.db",
            "configPath": "/config/opencode.jsonc",
            "live": true,
            "theme": "invalid",
            "defaultPeriodDays": 14,
            "customGroups": [{"name":"Work","projects":["alpha"],"extra":true}]
        }"#;
        fs::write(dir.join("settings.json"), original).unwrap();

        let (settings, diagnostic) = load_for_status(&dir);

        assert_eq!(settings.db_path.as_deref(), Some("/data/opencode.db"));
        assert_eq!(
            settings.config_path.as_deref(),
            Some("/config/opencode.jsonc")
        );
        assert!(settings.live);
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.default_period_days, 14);
        assert_eq!(settings.custom_groups[0].name, "Work");
        assert!(diagnostic
            .as_deref()
            .is_some_and(|message| message.contains("customGroups")));
        assert_eq!(
            fs::read_to_string(dir.join("settings.json")).unwrap(),
            original
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_json_without_language_loads_with_no_preference() {
        let dir = std::env::temp_dir().join("ocv_settings_legacy");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), r#"{"live":true,"theme":"dark"}"#).unwrap();

        let loaded = load(&dir).unwrap();

        assert!(loaded.language.is_none());
        assert!(loaded.live);
        assert_eq!(loaded.theme, "dark");
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn missing_returns_default() {
        let dir = std::env::temp_dir().join("ocv_settings_none");
        let _ = fs::remove_dir_all(&dir);
        let s = load(&dir).unwrap();
        assert!(!s.live);
        assert!(s.db_path.is_none());
    }

    #[test]
    fn malformed_json_returns_a_configuration_error() {
        let dir = test_dir("malformed");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), "{\"live\":").unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("JSON"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_field_type_returns_a_validation_error() {
        let dir = test_dir("invalid-type");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), r#"{"live":"yes"}"#).unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("validation"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_values_return_a_validation_error_without_rewriting_file() {
        let dir = test_dir("invalid-value");
        fs::create_dir_all(&dir).unwrap();
        let contents = r#"{"theme":"system","defaultPeriodDays":0}"#;
        let path = dir.join("settings.json");
        fs::write(&path, contents).unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("validation"));
        assert_eq!(fs::read_to_string(path).unwrap(), contents);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_theme_returns_a_validation_error() {
        let dir = test_dir("invalid-theme");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), r#"{"theme":"sepia"}"#).unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("validation"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn period_above_the_supported_limit_returns_a_validation_error() {
        let dir = test_dir("period-too-large");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), r#"{"defaultPeriodDays":3651}"#).unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("validation"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_settings_fields_are_rejected() {
        let dir = test_dir("unknown-field");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), r#"{"unexpected":true}"#).unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("validation"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_custom_group_fields_are_rejected() {
        let dir = test_dir("unknown-group-field");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("settings.json"),
            r#"{"customGroups":[{"name":"Clients","projects":[],"unexpected":true}]}"#,
        )
        .unwrap();

        let error = load(&dir).unwrap_err();

        assert!(error.contains("validation"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_save_leaves_only_the_final_settings_file() {
        let dir = test_dir("atomic-save");
        fs::create_dir_all(&dir).unwrap();

        save(&dir, &Settings::default()).unwrap();

        assert!(dir.join("settings.json").is_file());
        assert_eq!(temporary_files(&dir), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_restore_replaces_the_previous_settings_without_a_temporary_file() {
        let dir = test_dir("atomic-restore");
        fs::create_dir_all(&dir).unwrap();
        save(&dir, &Settings::default()).unwrap();
        let previous = snapshot(&dir).unwrap().unwrap();
        let changed = Settings {
            live: true,
            ..Settings::default()
        };
        save(&dir, &changed).unwrap();

        restore_snapshot(&dir, Some(&previous)).unwrap();

        assert!(!load(&dir).unwrap().live);
        assert_eq!(temporary_files(&dir), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    fn temporary_files(dir: &Path) -> usize {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".settings.json.")
            })
            .count()
    }

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ocv_settings_{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }
}
