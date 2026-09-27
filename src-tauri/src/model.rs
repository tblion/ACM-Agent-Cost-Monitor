use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub reasoning: f64,
}

impl Tokens {
    pub fn is_valid(&self) -> bool {
        [
            self.input,
            self.output,
            self.cache_read,
            self.cache_write,
            self.reasoning,
        ]
        .iter()
        .all(|value| value.is_finite() && *value >= 0.0)
    }

    pub fn add(&mut self, o: &Tokens) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.reasoning += o.reasoning;
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdown {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub reasoning: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub cost: f64,
    pub tokens: Tokens,
    pub source: CostSource,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CostSource {
    Configured,
    Stored,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub project: String,
    pub title: String,
    pub date: i64,
    pub cost: f64,
    pub tokens: Tokens,
    pub is_subagent: bool,
    pub parent_id: Option<String>,
    pub source: CostSource,
    pub models: Vec<ModelUsage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSummary {
    pub provider: String,
    pub model: String,
    pub messages: u64,
    pub stored_cost: f64,
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub db_path: Option<String>,
    pub config_path: Option<String>,
    pub live: bool,
    pub theme: String, // "system" | "light" | "dark"
    pub language: Option<String>,
    pub default_period_days: i64,
    pub custom_groups: Vec<CustomGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    pub settings: Settings,
    pub diagnostic: Option<AppError>,
    pub live_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomGroup {
    pub name: String,
    pub projects: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            db_path: None,
            config_path: None,
            live: false,
            theme: "system".into(),
            language: None,
            default_period_days: 30,
            custom_groups: vec![],
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPaths {
    pub db: String,
    pub config: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateEntry {
    pub provider: String,
    pub model: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub source: String,
    pub effective_from: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetrics {
    pub database_size_bytes: Option<u64>,
    pub process_memory_bytes: Option<u64>,
    pub measured_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatus {
    pub valid: bool,
    pub version: u32,
    pub generated_at: String,
    pub source_version: String,
    pub rate_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalculationDiagnostics {
    pub catalogue_valid: bool,
    pub recalculable_messages: usize,
    pub missing_dates: usize,
    pub missing_tokens: usize,
    pub missing_rates: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalculationResult {
    pub sessions: Vec<SessionRecord>,
    pub diagnostics: RecalculationDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub generated_at: String,
    pub valid: bool,
    pub provenance: AuditProvenance,
    pub summary: AuditSummary,
    pub messages: Vec<AuditMessage>,
    pub ignored: Vec<AuditIgnoredMessage>,
    pub sessions: Vec<AuditSession>,
    pub invariants: AuditInvariantStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditProvenance {
    pub database_path: String,
    pub config_path: String,
    pub catalog_path: String,
    pub catalog_version: u32,
    pub catalog_source_version: String,
    pub catalog_generated_at: String,
    pub catalog_rate_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditSummary {
    pub all_sessions: usize,
    pub total_messages: usize,
    pub sessions_with_assistant: usize,
    pub assistant_messages: usize,
    pub ignored_messages: usize,
    pub recalculable_messages: usize,
    pub custom_rate_messages: usize,
    pub catalog_rate_messages: usize,
    pub stored_fallback_messages: usize,
    pub missing_token_messages: usize,
    pub missing_date_messages: usize,
    pub missing_rate_messages: usize,
    pub stored_cost_total: f64,
    pub calculated_cost_total: f64,
    pub selected_cost_total: f64,
    pub tokens: Tokens,
    pub anomaly_counts: AuditAnomalyCounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditAnomalyCounts {
    pub missing_tokens: usize,
    pub missing_date: usize,
    pub missing_rate: usize,
    pub invalid_rate: usize,
    pub stored_cost_fallback: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditMessage {
    pub message_id: String,
    pub session_id: String,
    pub project: String,
    pub provider: String,
    pub model: String,
    pub message_date: Option<i64>,
    pub tokens: Option<Tokens>,
    pub stored_cost: f64,
    pub calculated_cost: Option<f64>,
    pub selected_cost: f64,
    pub cost_source: AuditCostSource,
    pub rate_source: Option<AuditRateSource>,
    pub effective_from: Option<String>,
    pub rate: Option<AuditRate>,
    pub breakdown: Option<CostBreakdown>,
    pub anomalies: Vec<AuditAnomaly>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRate {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuditCostSource {
    Configured,
    Catalog,
    Stored,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuditRateSource {
    Configured,
    Catalog,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuditAnomaly {
    MissingTokens,
    MissingDate,
    MissingRate,
    InvalidRate,
    StoredCostFallback,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditIgnoredMessage {
    pub message_id: String,
    pub session_id: String,
    pub role: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditSession {
    pub session_id: String,
    pub project: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub assistant_messages: usize,
    pub cost: f64,
    pub tokens: Tokens,
    pub message_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditInvariantStatus {
    pub valid: bool,
    pub failed: Vec<String>,
}
