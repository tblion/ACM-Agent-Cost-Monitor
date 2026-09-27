use crate::aggregate::{resolve_rate_detail, RateSource, RawRow};
use crate::cost::{message_cost_breakdown, Rate};
use crate::model::{
    AuditAnomaly, AuditAnomalyCounts, AuditCostSource, AuditIgnoredMessage, AuditInvariantStatus,
    AuditMessage, AuditProvenance, AuditRate, AuditRateSource, AuditReport, AuditSession,
    AuditSummary, CostBreakdown, Tokens,
};
use crate::pricing::PricingCatalog;
use chrono::Utc;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct AuditPaths {
    pub database_path: String,
    pub config_path: String,
    pub catalog_path: String,
}

#[derive(Debug, Clone)]
pub struct IgnoredRow {
    pub message_id: String,
    pub session_id: String,
    pub role: String,
}

#[derive(Debug, Clone)]
pub struct SessionRow {
    pub session_id: String,
    pub project: String,
    pub title: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Default)]
struct SessionAccumulator {
    project: String,
    title: String,
    parent_id: Option<String>,
    assistant_messages: usize,
    cost: f64,
    tokens: Tokens,
    message_ids: Vec<String>,
}

pub fn build_audit_report(
    rows: &[RawRow],
    ignored_rows: &[IgnoredRow],
    session_rows: &[SessionRow],
    total_sessions: usize,
    total_messages: usize,
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
    paths: AuditPaths,
) -> Result<AuditReport, String> {
    let mut failed = Vec::new();
    let mut sessions = BTreeMap::new();
    for session in session_rows {
        if sessions
            .insert(
                session.session_id.clone(),
                SessionAccumulator {
                    project: session.project.clone(),
                    title: session.title.clone(),
                    parent_id: session.parent_id.clone(),
                    ..SessionAccumulator::default()
                },
            )
            .is_some()
        {
            failed.push(format!("duplicateSession:{}", session.session_id));
        }
    }

    if total_sessions != session_rows.len() {
        failed.push("sessionCount".to_string());
    }
    if total_messages != rows.len() + ignored_rows.len() {
        failed.push("messageClassification".to_string());
    }

    let mut sorted_rows = rows.to_vec();
    sorted_rows.sort_by(|left, right| left.message_id.cmp(&right.message_id));
    let mut seen_message_ids = HashSet::new();
    let mut messages = Vec::with_capacity(sorted_rows.len());
    let mut stored_cost_total = 0.0;
    let mut calculated_cost_total = 0.0;
    let mut selected_cost_total = 0.0;
    let mut summary_tokens = Tokens::default();
    let mut recalculable_messages = 0;
    let mut custom_rate_messages = 0;
    let mut catalog_rate_messages = 0;
    let mut stored_fallback_messages = 0;
    let mut missing_token_messages = 0;
    let mut missing_date_messages = 0;
    let mut missing_rate_messages = 0;
    let mut anomaly_counts = AuditAnomalyCounts {
        missing_tokens: 0,
        missing_date: 0,
        missing_rate: 0,
        invalid_rate: 0,
        stored_cost_fallback: 0,
    };

    for row in &sorted_rows {
        if !seen_message_ids.insert(row.message_id.clone()) {
            failed.push(format!("duplicateMessage:{}", row.message_id));
        }

        let tokens = row.tokens.filter(Tokens::is_valid);
        let invalid_custom_rate = overrides
            .get(&(row.provider.clone(), row.model.clone()))
            .is_some_and(|rate| !rate.is_valid());
        let resolved_rate = resolve_rate_detail(row, catalog, overrides);
        let mut anomalies = Vec::new();
        if tokens.is_none() {
            anomalies.push(AuditAnomaly::MissingTokens);
            missing_token_messages += 1;
            anomaly_counts.missing_tokens += 1;
        }
        if row.message_date.is_none() {
            anomalies.push(AuditAnomaly::MissingDate);
            missing_date_messages += 1;
            anomaly_counts.missing_date += 1;
        }
        if invalid_custom_rate {
            anomalies.push(AuditAnomaly::InvalidRate);
            anomaly_counts.invalid_rate += 1;
        }
        if resolved_rate.is_none() {
            anomalies.push(AuditAnomaly::MissingRate);
            missing_rate_messages += 1;
            anomaly_counts.missing_rate += 1;
        }

        let rate_source = resolved_rate
            .as_ref()
            .map(|resolved| match resolved.source {
                RateSource::Configured => {
                    custom_rate_messages += 1;
                    AuditRateSource::Configured
                }
                RateSource::Catalog => {
                    catalog_rate_messages += 1;
                    AuditRateSource::Catalog
                }
            });
        let rate = resolved_rate.as_ref().map(|resolved| AuditRate {
            input: resolved.rate.input,
            output: resolved.rate.output,
            cache_read: resolved.rate.cache_read,
            cache_write: resolved.rate.cache_write,
        });
        let effective_from = resolved_rate
            .as_ref()
            .and_then(|resolved| resolved.effective_from.clone());
        let breakdown = tokens
            .zip(resolved_rate.as_ref().map(|resolved| resolved.rate))
            .map(|(tokens, rate)| message_cost_breakdown(&tokens, &rate));
        let calculated_cost = tokens
            .zip(resolved_rate.as_ref().map(|resolved| resolved.rate))
            .map(|(tokens, rate)| independent_cost_reference(&tokens, &rate));
        let selected_cost = calculated_cost.unwrap_or(row.stored_cost);
        let cost_source = if calculated_cost.is_some() {
            recalculable_messages += 1;
            match rate_source {
                Some(AuditRateSource::Configured) => AuditCostSource::Configured,
                Some(AuditRateSource::Catalog) => AuditCostSource::Catalog,
                None => unreachable!("a calculated message has a rate source"),
            }
        } else {
            anomalies.push(AuditAnomaly::StoredCostFallback);
            stored_fallback_messages += 1;
            anomaly_counts.stored_cost_fallback += 1;
            AuditCostSource::Stored
        };

        if let Some(tokens) = tokens {
            summary_tokens.add(&tokens);
        }
        stored_cost_total += row.stored_cost;
        calculated_cost_total += calculated_cost.unwrap_or(0.0);
        selected_cost_total += selected_cost;

        let session = sessions.entry(row.session_id.clone()).or_insert_with(|| {
            failed.push(format!("missingSession:{}", row.session_id));
            SessionAccumulator {
                project: row.project.clone(),
                title: row.title.clone(),
                parent_id: row.parent_id.clone(),
                ..SessionAccumulator::default()
            }
        });
        session.assistant_messages += 1;
        session.cost += selected_cost;
        if let Some(tokens) = tokens {
            session.tokens.add(&tokens);
        }
        session.message_ids.push(row.message_id.clone());

        messages.push(AuditMessage {
            message_id: row.message_id.clone(),
            session_id: row.session_id.clone(),
            project: row.project.clone(),
            provider: row.provider.clone(),
            model: row.model.clone(),
            message_date: row.message_date,
            tokens,
            stored_cost: row.stored_cost,
            calculated_cost,
            selected_cost,
            cost_source,
            rate_source,
            effective_from,
            rate,
            breakdown,
            anomalies,
        });
    }

    for message in &messages {
        let row = sorted_rows
            .iter()
            .find(|row| row.message_id == message.message_id)
            .expect("message row exists for invariant checks");
        if let (Some(breakdown), Some(tokens), Some(resolved)) = (
            message.breakdown,
            row.tokens.filter(Tokens::is_valid),
            resolve_rate_detail(row, catalog, overrides),
        ) {
            if !breakdown_matches_reference(
                &breakdown,
                message.calculated_cost.unwrap_or(f64::NAN),
                &tokens,
                &resolved.rate,
            ) {
                failed.push(format!("breakdownCost:{}", message.message_id));
            }
        }
        if !rate_provenance_matches(
            row,
            message.rate_source,
            message.effective_from.as_deref(),
            message.rate.as_ref(),
            catalog,
            overrides,
        ) {
            failed.push(format!("rateProvenance:{}", message.message_id));
        }
    }

    let mut ignored = ignored_rows
        .iter()
        .map(|row| AuditIgnoredMessage {
            message_id: row.message_id.clone(),
            session_id: row.session_id.clone(),
            role: row.role.clone(),
            reason: "nonAssistant".to_string(),
        })
        .collect::<Vec<_>>();
    ignored.sort_by(|left, right| left.message_id.cmp(&right.message_id));

    let mut audit_sessions = Vec::with_capacity(sessions.len());
    for (session_id, mut session) in sessions {
        session.message_ids.sort();
        let session_messages = messages
            .iter()
            .filter(|message| message.session_id == session_id)
            .collect::<Vec<_>>();
        let message_cost = session_messages
            .iter()
            .map(|message| message.selected_cost)
            .sum::<f64>();
        if !approximately_equal(session.cost, message_cost) {
            failed.push(format!("sessionCost:{session_id}"));
        }
        let message_tokens =
            session_messages
                .iter()
                .fold(Tokens::default(), |mut total, message| {
                    if let Some(tokens) = message.tokens {
                        total.add(&tokens);
                    }
                    total
                });
        if !tokens_equal(session.tokens, message_tokens) {
            failed.push(format!("sessionTokens:{session_id}"));
        }
        if session.assistant_messages != session_messages.len() {
            failed.push(format!("sessionMessages:{session_id}"));
        }
        audit_sessions.push(AuditSession {
            session_id,
            project: session.project,
            title: session.title,
            parent_id: session.parent_id,
            assistant_messages: session.assistant_messages,
            cost: session.cost,
            tokens: session.tokens,
            message_ids: session.message_ids,
        });
    }

    let invariant_status = AuditInvariantStatus {
        valid: failed.is_empty(),
        failed,
    };
    let valid = invariant_status.valid;
    let summary = AuditSummary {
        all_sessions: total_sessions,
        total_messages,
        sessions_with_assistant: audit_sessions
            .iter()
            .filter(|session| session.assistant_messages > 0)
            .count(),
        assistant_messages: messages.len(),
        ignored_messages: ignored.len(),
        recalculable_messages,
        custom_rate_messages,
        catalog_rate_messages,
        stored_fallback_messages,
        missing_token_messages,
        missing_date_messages,
        missing_rate_messages,
        stored_cost_total,
        calculated_cost_total,
        selected_cost_total,
        tokens: summary_tokens,
        anomaly_counts,
    };

    Ok(AuditReport {
        generated_at: Utc::now().to_rfc3339(),
        valid,
        provenance: AuditProvenance {
            database_path: paths.database_path,
            config_path: paths.config_path,
            catalog_path: paths.catalog_path,
            catalog_version: catalog.version,
            catalog_source_version: catalog.source_version.clone(),
            catalog_generated_at: catalog.generated_at.clone(),
            catalog_rate_count: catalog.rates.len(),
        },
        summary,
        messages,
        ignored,
        sessions: audit_sessions,
        invariants: invariant_status,
    })
}

fn rate_provenance_matches(
    row: &RawRow,
    source: Option<AuditRateSource>,
    effective_from: Option<&str>,
    rate: Option<&AuditRate>,
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> bool {
    let expected = independent_rate_provenance(row, catalog, overrides);
    match (expected, source, effective_from, rate) {
        (None, None, None, None) => true,
        (Some(expected), Some(source), effective_from, Some(rate)) => {
            audit_rate_sources_equal(expected.source, source)
                && effective_from == expected.effective_from.as_deref()
                && approximately_audit_rate(rate, expected.rate)
        }
        _ => false,
    }
}

struct IndependentRateProvenance {
    source: AuditRateSource,
    rate: AuditRate,
    effective_from: Option<String>,
}

fn independent_rate_provenance(
    row: &RawRow,
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Option<IndependentRateProvenance> {
    let key = (row.provider.clone(), row.model.clone());
    if let Some(custom_rate) = overrides.get(&key).filter(|rate| rate.is_valid()) {
        return Some(IndependentRateProvenance {
            source: AuditRateSource::Configured,
            rate: AuditRate {
                input: custom_rate.input,
                output: custom_rate.output,
                cache_read: custom_rate.cache_read,
                cache_write: custom_rate.cache_write,
            },
            effective_from: None,
        });
    }

    let message_date = row.message_date?;
    let catalog_rate = catalog.pricing_rate_for(&row.provider, &row.model, message_date)?;
    let rate = Rate {
        input: catalog_rate.input,
        output: catalog_rate.output,
        cache_read: catalog_rate.cache_read,
        cache_write: catalog_rate.cache_write,
    };
    rate.is_valid().then_some(IndependentRateProvenance {
        source: AuditRateSource::Catalog,
        rate: AuditRate {
            input: rate.input,
            output: rate.output,
            cache_read: rate.cache_read,
            cache_write: rate.cache_write,
        },
        effective_from: Some(catalog_rate.effective_from.clone()),
    })
}

fn audit_rate_sources_equal(left: AuditRateSource, right: AuditRateSource) -> bool {
    matches!(
        (left, right),
        (AuditRateSource::Configured, AuditRateSource::Configured)
            | (AuditRateSource::Catalog, AuditRateSource::Catalog)
    )
}

fn approximately_audit_rate(actual: &AuditRate, expected: AuditRate) -> bool {
    approximately_equal(actual.input, expected.input)
        && approximately_equal(actual.output, expected.output)
        && approximately_equal(actual.cache_read, expected.cache_read)
        && approximately_equal(actual.cache_write, expected.cache_write)
}

fn independent_cost_reference(tokens: &Tokens, rate: &Rate) -> f64 {
    tokens.input * rate.input / 1_000_000.0
        + tokens.output * rate.output / 1_000_000.0
        + tokens.cache_read * rate.cache_read / 1_000_000.0
        + tokens.cache_write * rate.cache_write / 1_000_000.0
        + tokens.reasoning * rate.output / 1_000_000.0
}

fn breakdown_matches_reference(
    breakdown: &CostBreakdown,
    calculated_cost: f64,
    tokens: &Tokens,
    rate: &Rate,
) -> bool {
    let reference = independent_cost_reference(tokens, rate);
    approximately_equal(breakdown.total, reference)
        && approximately_equal(calculated_cost, reference)
}

fn tokens_equal(left: Tokens, right: Tokens) -> bool {
    approximately_equal(left.input, right.input)
        && approximately_equal(left.output, right.output)
        && approximately_equal(left.cache_read, right.cache_read)
        && approximately_equal(left.cache_write, right.cache_write)
        && approximately_equal(left.reasoning, right.reasoning)
}

fn approximately_equal(left: f64, right: f64) -> bool {
    if left == right {
        return true;
    }
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= 1e-9 * scale
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CostBreakdown;

    #[test]
    fn breakdown_invariant_uses_an_independent_raw_token_reference() {
        let tokens = Tokens {
            input: 1_000_000.0,
            output: 1_000_000.0,
            cache_read: 1_000_000.0,
            cache_write: 1_000_000.0,
            reasoning: 1_000_000.0,
        };
        let rate = Rate {
            input: 2.0,
            output: 8.0,
            cache_read: 0.2,
            cache_write: 2.5,
        };
        let derived_breakdown = CostBreakdown {
            input: 0.0,
            output: 8.0,
            cache_read: 0.2,
            cache_write: 2.5,
            reasoning: 8.0,
            total: 18.7,
        };

        assert!(!breakdown_matches_reference(
            &derived_breakdown,
            18.7,
            &tokens,
            &rate,
        ));
    }

    #[test]
    fn breakdown_invariant_uses_all_components_and_rejects_a_divergent_total() {
        let breakdown = CostBreakdown {
            input: 1.0,
            output: 2.0,
            cache_read: 3.0,
            cache_write: 4.0,
            reasoning: 5.0,
            total: 99.0,
        };
        let tokens = Tokens {
            input: 1_000_000.0,
            output: 1_000_000.0,
            cache_read: 1_000_000.0,
            cache_write: 1_000_000.0,
            reasoning: 1_000_000.0,
        };
        let rate = Rate {
            input: 1.0,
            output: 5.0,
            cache_read: 3.0,
            cache_write: 4.0,
        };

        assert_eq!(
            breakdown.input
                + breakdown.output
                + breakdown.cache_read
                + breakdown.cache_write
                + breakdown.reasoning,
            15.0
        );
        assert!(!breakdown_matches_reference(
            &breakdown, 15.0, &tokens, &rate
        ));
    }

    #[test]
    fn independent_provenance_candidate_prefers_valid_custom_rate_over_catalogue() {
        let row = RawRow {
            message_id: "message".into(),
            project: "project".into(),
            session_id: "session".into(),
            title: "title".into(),
            parent_id: None,
            date: 1_750_000_000_000,
            message_date: Some(1_750_000_000_000),
            provider: "provider".into(),
            model: "model".into(),
            stored_cost: 0.0,
            tokens: Some(Tokens::default()),
        };
        let catalog = PricingCatalog {
            version: 1,
            generated_at: "2026-01-01T00:00:00Z".into(),
            source_version: "test".into(),
            rates: vec![crate::pricing::PricingRate {
                provider: "provider".into(),
                model: "model".into(),
                effective_from: "2025-01-01T00:00:00Z".into(),
                input: 1.0,
                output: 2.0,
                cache_read: 0.0,
                cache_write: 0.0,
                source: "test".into(),
            }],
        };
        let mut overrides = HashMap::new();
        overrides.insert(
            ("provider".into(), "model".into()),
            Rate {
                input: 10.0,
                output: 20.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );

        let candidate = independent_rate_provenance(&row, &catalog, &overrides)
            .expect("a valid custom candidate");

        assert!(matches!(candidate.source, AuditRateSource::Configured));
        assert_eq!(candidate.effective_from, None);
        assert_eq!(candidate.rate.input, 10.0);
        assert!(!rate_provenance_matches(
            &row,
            Some(AuditRateSource::Catalog),
            Some("2025-01-01T00:00:00Z"),
            Some(&AuditRate {
                input: 1.0,
                output: 2.0,
                cache_read: 0.0,
                cache_write: 0.0,
            }),
            &catalog,
            &overrides,
        ));
    }
}
