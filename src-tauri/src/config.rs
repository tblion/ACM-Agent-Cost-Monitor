use crate::cost::Rate;
use crate::jsonc::{strip_comments, strip_trailing_commas};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Default path for the opencode config.
/// opencode uses the XDG convention (including on Windows):
/// $XDG_CONFIG_HOME/opencode/opencode.jsonc or ~/.config/opencode/opencode.jsonc
pub fn default_config_path() -> PathBuf {
    default_config_base_dir()
        .join("opencode")
        .join("opencode.jsonc")
}

fn default_config_base_dir() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(".config"))
}

/// Return the first existing configuration file according to OpenCode priority.
pub fn resolve_config_path(custom: Option<&str>) -> PathBuf {
    resolve_config_path_in(custom.map(Path::new), &default_config_base_dir())
}

fn resolve_config_path_in(custom: Option<&Path>, base_dir: &Path) -> PathBuf {
    let jsonc = base_dir.join("opencode").join("opencode.jsonc");
    let json = base_dir.join("opencode").join("opencode.json");
    let candidates: Vec<PathBuf> = custom
        .into_iter()
        .map(Path::to_path_buf)
        .chain([jsonc.clone(), json])
        .collect();

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or(jsonc)
}

pub fn extract_rates(config_text: &str) -> Result<HashMap<(String, String), Rate>, String> {
    let json = strip_trailing_commas(&strip_comments(config_text));
    let v: Value = serde_json::from_str(&json).map_err(|e| format!("JSON invalide: {e}"))?;
    let mut rates = HashMap::new();
    if let Some(providers) = v.get("provider").and_then(|p| p.as_object()) {
        for (pid, pval) in providers {
            if let Some(models) = pval.get("models").and_then(|m| m.as_object()) {
                for (mid, mval) in models {
                    let Some(cost_value) = mval.get("cost") else {
                        continue;
                    };
                    let cost = cost_value.as_object().ok_or_else(|| {
                        format!("Tarif {pid}/{mid}: le champ cost doit être un objet")
                    })?;
                    let rate = Rate {
                        input: parse_rate_field(cost, pid, mid, "input")?,
                        output: parse_rate_field(cost, pid, mid, "output")?,
                        cache_read: parse_rate_field(cost, pid, mid, "cache_read")?,
                        cache_write: parse_rate_field(cost, pid, mid, "cache_write")?,
                    };
                    rates.insert((pid.clone(), mid.clone()), rate);
                }
            }
        }
    }
    Ok(rates)
}

fn parse_rate_field(
    cost: &serde_json::Map<String, Value>,
    provider: &str,
    model: &str,
    field: &str,
) -> Result<f64, String> {
    let Some(value) = cost.get(field) else {
        return Ok(0.0);
    };
    let number = value
        .as_f64()
        .ok_or_else(|| format!("Tarif {provider}/{model}: le champ {field} doit être un nombre"))?;
    if !number.is_finite() || number < 0.0 {
        return Err(format!(
            "Tarif {provider}/{model}: le champ {field} doit être un nombre fini positif ou nul"
        ));
    }
    Ok(number)
}

/// Load rates from a configuration path; missing files yield no overrides, while parsing and other read errors are returned.
pub fn load_rates(path: &Path) -> Result<HashMap<(String, String), Rate>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => extract_rates(&text)
            .map_err(|error| format!("Configuration invalide dans {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(format!("Lecture de la configuration impossible: {error}")),
    }
}

pub fn load_rates_strict(path: &Path) -> Result<HashMap<(String, String), Rate>, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("Lecture de la configuration impossible: {error}"))?;
    extract_rates(&text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempConfigDir {
        path: PathBuf,
    }

    impl TempConfigDir {
        fn new() -> Self {
            let base = std::env::temp_dir();
            for attempt in 0..100 {
                let suffix = format!(
                    "{}-{attempt}",
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                );
                let path = base.join(format!("opencode-costs-config-{suffix}"));
                match fs::create_dir(&path) {
                    Ok(()) => {
                        fs::create_dir(path.join("opencode")).unwrap();
                        return Self { path };
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("création du répertoire temporaire impossible: {error}"),
                }
            }
            panic!("impossible de créer un répertoire temporaire unique");
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempConfigDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temp_config_dir() -> TempConfigDir {
        TempConfigDir::new()
    }

    fn write_config(path: &Path, content: &str) {
        fs::write(path, content).unwrap();
    }

    #[test]
    fn extracts_rates_and_skips_missing() {
        let text = std::fs::read_to_string("fixtures/config.jsonc").unwrap();
        let rates = extract_rates(&text).unwrap();
        assert!(rates.contains_key(&("llmproxy".into(), "openai/gpt-4.1".into())));
        assert!((rates[&("llmproxy".into(), "openai/gpt-4.1".into())].input - 2.0).abs() < 1e-9);
        assert!(
            (rates[&("llmproxy".into(), "vertex_ai/claude-sonnet-4-6".into())].cache_read - 0.33)
                .abs()
                < 1e-9
        );
        assert!(!rates.contains_key(&("openrama".into(), "qwen3.8-27b".into())));
    }
    #[test]
    fn handles_trailing_comma_after_comment() {
        // Real case: a commented field after a comma leaves a trailing comma.
        let text = r#"{
          "provider": {
            "llmproxy": {
              "models": {
                "openai/gpt-4.1": { "cost": { "input": 2, "output": 8, "cache_read": 0.5, "cache_write": 2 }, }
              },
            },
          },
        }"#;
        let rates = extract_rates(text).expect("doit parser malgré la virgule finale");
        assert!(rates.contains_key(&("llmproxy".into(), "openai/gpt-4.1".into())));
    }

    #[test]
    fn resolves_custom_path_before_default_files() {
        let base = temp_config_dir();
        let custom = base.path().join("custom.json");
        write_config(&custom, "{}");
        write_config(&base.path().join("opencode/opencode.jsonc"), "{}");
        write_config(&base.path().join("opencode/opencode.json"), "{}");

        assert_eq!(
            resolve_config_path_in(Some(custom.as_path()), base.path()),
            custom
        );
    }

    #[test]
    fn falls_back_from_missing_custom_to_jsonc_then_json() {
        let base = temp_config_dir();
        let custom = base.path().join("missing.json");
        let jsonc = base.path().join("opencode/opencode.jsonc");
        let json = base.path().join("opencode/opencode.json");
        write_config(&jsonc, "{}");
        write_config(&json, "{}");

        assert_eq!(
            resolve_config_path_in(Some(custom.as_path()), base.path()),
            jsonc
        );
        fs::remove_file(&jsonc).unwrap();
        assert_eq!(
            resolve_config_path_in(Some(custom.as_path()), base.path()),
            json
        );
    }

    #[test]
    fn missing_configuration_returns_jsonc_candidate() {
        let base = temp_config_dir();
        let expected = base.path().join("opencode/opencode.jsonc");

        assert_eq!(resolve_config_path_in(None, base.path()), expected);
    }

    #[test]
    fn parses_json_with_comments_and_trailing_commas() {
        let text = r#"
        {
          // JSONC syntax is accepted for the .json format too
          "provider": {
            "local": {
              "models": {
                "model": { "cost": { "input": 1, "output": 2, }, },
              },
            },
          },
        }
        "#;

        let rates = extract_rates(text).unwrap();
        assert_eq!(
            rates[&(String::from("local"), String::from("model"))].input,
            1.0
        );
        assert_eq!(
            rates[&(String::from("local"), String::from("model"))].output,
            2.0
        );
    }

    #[test]
    fn resolves_json_then_loads_rates_from_file() {
        let base = temp_config_dir();
        let json = base.path().join("opencode/opencode.json");
        write_config(
            &json,
            r#"{
              "provider": {
                "local": {
                  "models": {
                    "file-model": { "cost": { "input": 3, "output": 4, }, },
                  },
                },
              },
            }"#,
        );

        let resolved = resolve_config_path_in(None, base.path());
        let rates = load_rates(&resolved).expect("configuration is valid");

        assert_eq!(resolved, json);
        assert_eq!(
            rates[&(String::from("local"), String::from("file-model"))].input,
            3.0
        );
    }

    #[test]
    fn invalid_prioritized_file_is_selected_and_returns_an_error() {
        let base = temp_config_dir();
        let custom = base.path().join("custom.json");
        let jsonc = base.path().join("opencode/opencode.jsonc");
        write_config(&custom, "{ invalid");
        write_config(
            &jsonc,
            r#"{ "provider": { "fallback": { "models": { "model": { "cost": { "input": 1 } } } } } }"#,
        );

        let resolved = resolve_config_path_in(Some(custom.as_path()), base.path());

        assert_eq!(resolved, custom);
        let error = load_rates(&resolved).expect_err("invalid configuration must fail");
        assert!(error.contains("JSON invalide"));
    }

    #[test]
    fn invalid_configuration_produces_an_explicit_error() {
        let error = extract_rates("{ invalid").expect_err("invalid configuration must fail");
        assert!(error.contains("JSON invalide"));
    }

    #[test]
    fn rejects_present_non_numeric_rate_fields() {
        let error = extract_rates(
            r#"{
              "provider": {
                "local": {
                  "models": {
                    "model": { "cost": { "input": "not-a-number" } }
                  }
                }
              }
            }"#,
        )
        .expect_err("a present non-numeric rate must fail");

        assert!(error.contains("local/model"));
        assert!(error.contains("input"));
        assert!(error.contains("nombre"));
    }

    #[test]
    fn missing_rate_fields_keep_the_zero_fallback() {
        let rates = extract_rates(
            r#"{
              "provider": {
                "local": {
                  "models": {
                    "model": { "cost": { "input": 2 } }
                  }
                }
              }
            }"#,
        )
        .expect("configuration with omitted optional fields is valid");

        let rate = rates
            .get(&(String::from("local"), String::from("model")))
            .expect("rate exists");
        assert_eq!(rate.input, 2.0);
        assert_eq!(rate.output, 0.0);
        assert_eq!(rate.cache_read, 0.0);
        assert_eq!(rate.cache_write, 0.0);
    }

    #[test]
    fn missing_configuration_is_the_only_load_fallback() {
        let base = temp_config_dir();
        let missing = base.path().join("missing.jsonc");

        assert!(load_rates(&missing)
            .expect("missing configuration is an allowed fallback")
            .is_empty());
    }
}
