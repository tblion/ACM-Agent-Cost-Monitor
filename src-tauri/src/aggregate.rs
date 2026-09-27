use crate::cost::{message_cost, Rate};
use crate::model::{CostSource, ModelUsage, SessionRecord, Tokens};
use crate::pricing::PricingCatalog;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct RawRow {
    pub message_id: String,
    pub project: String,
    pub session_id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub date: i64,
    pub message_date: Option<i64>,
    pub provider: String,
    pub model: String,
    pub stored_cost: f64,
    pub tokens: Option<Tokens>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateSource {
    Configured,
    Catalog,
}

#[derive(Debug, Clone)]
pub struct ResolvedRate {
    pub rate: Rate,
    pub source: RateSource,
    pub effective_from: Option<String>,
}

pub fn resolve_rate_detail(
    row: &RawRow,
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Option<ResolvedRate> {
    if let Some(rate) = overrides.get(&(row.provider.clone(), row.model.clone())) {
        if rate.is_valid() {
            return Some(ResolvedRate {
                rate: *rate,
                source: RateSource::Configured,
                effective_from: None,
            });
        }
    }

    row.message_date.and_then(|date| {
        catalog
            .pricing_rate_for(&row.provider, &row.model, date)
            .and_then(|rate| {
                let resolved_rate = Rate {
                    input: rate.input,
                    output: rate.output,
                    cache_read: rate.cache_read,
                    cache_write: rate.cache_write,
                };
                resolved_rate.is_valid().then_some(ResolvedRate {
                    rate: resolved_rate,
                    source: RateSource::Catalog,
                    effective_from: Some(rate.effective_from.clone()),
                })
            })
    })
}

pub fn resolve_rate(
    row: &RawRow,
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Option<Rate> {
    resolve_rate_detail(row, catalog, overrides).map(|resolved| resolved.rate)
}

pub fn aggregate(
    rows: &[RawRow],
    catalog: &PricingCatalog,
    overrides: &HashMap<(String, String), Rate>,
) -> Vec<SessionRecord> {
    let mut map: HashMap<String, SessionRecord> = HashMap::new();
    for r in rows {
        let configured_rate = r
            .tokens
            .as_ref()
            .filter(|tokens| tokens.is_valid())
            .and_then(|_| resolve_rate(r, catalog, overrides));
        let (cost, used) = configured_rate
            .map(|rate| (message_cost(r.tokens.as_ref().unwrap(), &rate), true))
            .unwrap_or((r.stored_cost, false));
        let rec = map
            .entry(r.session_id.clone())
            .or_insert_with(|| SessionRecord {
                id: r.session_id.clone(),
                project: r.project.clone(),
                title: r.title.clone(),
                date: r.date,
                cost: 0.0,
                tokens: Tokens::default(),
                is_subagent: r.parent_id.is_some(),
                parent_id: r.parent_id.clone(),
                source: CostSource::Configured,
                models: vec![],
            });
        rec.cost += cost;
        let tokens = r.tokens.unwrap_or_default();
        rec.tokens.add(&tokens);
        let source = if used {
            CostSource::Configured
        } else {
            CostSource::Stored
        };
        if !used {
            rec.source = CostSource::Stored;
        }
        if let Some(mu) = rec
            .models
            .iter_mut()
            .find(|m| m.provider == r.provider && m.model == r.model)
        {
            mu.cost += cost;
            mu.tokens.add(&tokens);
            if !used {
                mu.source = CostSource::Stored;
            }
        } else {
            rec.models.push(ModelUsage {
                provider: r.provider.clone(),
                model: r.model.clone(),
                cost,
                tokens,
                source,
            });
        }
    }
    for session in map.values_mut() {
        session.models.sort_by(|a, b| {
            a.provider
                .cmp(&b.provider)
                .then_with(|| a.model.cmp(&b.model))
        });
    }
    let mut out: Vec<SessionRecord> = map.into_values().collect();
    out.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.id.cmp(&b.id)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CostSource;
    use crate::pricing::{PricingCatalog, PricingRate};

    fn catalog() -> PricingCatalog {
        PricingCatalog {
            version: 1,
            generated_at: "2026-01-01T00:00:00Z".into(),
            source_version: "test".into(),
            rates: vec![PricingRate {
                provider: "llmproxy".into(),
                model: "openai/gpt-4.1".into(),
                effective_from: "2020-01-01T00:00:00Z".into(),
                input: 2.0,
                output: 8.0,
                cache_read: 0.0,
                cache_write: 0.0,
                source: "test".into(),
            }],
        }
    }
    fn row(
        provider: &str,
        model: &str,
        input: f64,
        output: f64,
        sid: &str,
        parent: Option<&str>,
    ) -> RawRow {
        RawRow {
            message_id: format!("{sid}-message"),
            project: "C:/git/demo".into(),
            session_id: sid.into(),
            title: "t".into(),
            parent_id: parent.map(|s| s.into()),
            date: 1700000000000,
            message_date: Some(1700000000000),
            provider: provider.into(),
            model: model.into(),
            stored_cost: 0.0,
            tokens: Some(Tokens {
                input,
                output,
                cache_read: 0.0,
                cache_write: 0.0,
                reasoning: 0.0,
            }),
        }
    }
    #[test]
    fn aggregates_and_applies_rate() {
        let mut rates = HashMap::new();
        rates.insert(
            ("llmproxy".into(), "openai/gpt-4.1".into()),
            Rate {
                input: 2.0,
                output: 8.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );
        let rows = vec![
            row(
                "llmproxy",
                "openai/gpt-4.1",
                1000000.0,
                100000.0,
                "s1",
                None,
            ),
            row("llmproxy", "openai/gpt-4.1", 500000.0, 50000.0, "s1", None),
        ];
        let out = aggregate(&rows, &catalog(), &rates);
        assert_eq!(out.len(), 1);
        // (1e6*2 + 1e5*8)/1e6 + (5e5*2 + 5e4*8)/1e6 = 2.8 + 1.4 = 4.2
        assert!((out[0].cost - 4.2).abs() < 1e-6);
        assert_eq!(out[0].models.len(), 1);
        assert_eq!(out[0].source, CostSource::Configured);
        assert_eq!(out[0].models[0].source, CostSource::Configured);
    }

    #[test]
    fn explicit_override_wins_over_applicable_catalog_rate() {
        let mut overrides = HashMap::new();
        overrides.insert(
            ("llmproxy".into(), "openai/gpt-4.1".into()),
            Rate {
                input: 10.0,
                output: 20.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );
        let row = row(
            "llmproxy",
            "openai/gpt-4.1",
            1_000_000.0,
            0.0,
            "override",
            None,
        );

        let resolved = resolve_rate(&row, &catalog(), &overrides).expect("a rate");
        let sessions = aggregate(&[row], &catalog(), &overrides);

        assert_eq!(resolved.input, 10.0);
        assert_eq!(sessions[0].cost, 10.0);
    }

    #[test]
    fn rate_resolution_exposes_configured_and_catalog_provenance() {
        let catalog = PricingCatalog {
            version: 1,
            generated_at: "2026-01-01T00:00:00Z".into(),
            source_version: "test".into(),
            rates: vec![
                PricingRate {
                    provider: "llmproxy".into(),
                    model: "openai/gpt-4.1".into(),
                    effective_from: "2020-01-01T00:00:00Z".into(),
                    input: 2.0,
                    output: 8.0,
                    cache_read: 0.0,
                    cache_write: 0.0,
                    source: "test".into(),
                },
                PricingRate {
                    provider: "llmproxy".into(),
                    model: "openai/gpt-4.1".into(),
                    effective_from: "2025-01-01T00:00:00Z".into(),
                    input: 3.0,
                    output: 9.0,
                    cache_read: 0.0,
                    cache_write: 0.0,
                    source: "test".into(),
                },
            ],
        };
        let row = row("llmproxy", "openai/gpt-4.1", 0.0, 0.0, "provenance", None);
        let mut overrides = HashMap::new();
        overrides.insert(
            ("llmproxy".into(), "openai/gpt-4.1".into()),
            Rate {
                input: 10.0,
                output: 20.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );

        let configured = resolve_rate_detail(&row, &catalog, &overrides).expect("configured rate");
        assert_eq!(configured.source, RateSource::Configured);
        assert_eq!(configured.effective_from, None);
        assert_eq!(configured.rate.input, 10.0);

        let catalog_rate =
            resolve_rate_detail(&row, &catalog, &HashMap::new()).expect("catalog rate");
        assert_eq!(catalog_rate.source, RateSource::Catalog);
        assert_eq!(
            catalog_rate.effective_from.as_deref(),
            Some("2020-01-01T00:00:00Z")
        );
        assert_eq!(catalog_rate.rate.input, 2.0);
    }
    #[test]
    fn no_rate_uses_stored_cost() {
        let rates = HashMap::new();
        let rows = vec![row(
            "openrama",
            "qwen3.8-27b",
            999999.0,
            1.0,
            "s2",
            Some("s1"),
        )];
        let out = aggregate(&rows, &catalog(), &rates);
        assert_eq!(out[0].cost, 0.0);
        assert_eq!(out[0].source, CostSource::Stored);
        assert_eq!(out[0].models[0].source, CostSource::Stored);
        assert!(out[0].is_subagent);
    }

    #[test]
    fn mixed_session_is_stored() {
        let mut rates = HashMap::new();
        rates.insert(
            ("llmproxy".into(), "configured-model".into()),
            Rate {
                input: 2.0,
                output: 8.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );
        let mut stored = row("openrama", "stored-model", 100.0, 10.0, "mixed", None);
        stored.stored_cost = 1.5;
        let rows = vec![
            row("llmproxy", "configured-model", 100.0, 10.0, "mixed", None),
            stored,
        ];

        let out = aggregate(&rows, &catalog(), &rates);

        assert_eq!(out[0].source, CostSource::Stored);
        assert_eq!(out[0].models[0].source, CostSource::Configured);
        assert_eq!(out[0].models[1].source, CostSource::Stored);
    }

    #[test]
    fn preserves_provenance_and_costs_for_parent_and_subsession() {
        let mut rates = HashMap::new();
        rates.insert(
            ("llmproxy".into(), "configured-model".into()),
            Rate {
                input: 2.0,
                output: 8.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );
        let mut child = row(
            "openrama",
            "stored-model",
            100.0,
            10.0,
            "child",
            Some("parent"),
        );
        child.stored_cost = 1.5;
        let rows = vec![
            row("llmproxy", "configured-model", 100.0, 10.0, "parent", None),
            child,
        ];

        let out = aggregate(&rows, &catalog(), &rates);
        let parent = out.iter().find(|session| session.id == "parent").unwrap();
        let child = out.iter().find(|session| session.id == "child").unwrap();

        assert!((parent.cost - 0.00028).abs() < 1e-9);
        assert_eq!(parent.source, CostSource::Configured);
        assert_eq!(parent.models[0].source, CostSource::Configured);
        assert_eq!(child.cost, 1.5);
        assert_eq!(child.source, CostSource::Stored);
        assert_eq!(child.models[0].source, CostSource::Stored);
        assert!(child.is_subagent);
        assert_eq!(child.parent_id.as_deref(), Some("parent"));
    }

    #[test]
    fn stored_tokens_fallback_is_not_priced_when_tokens_are_invalid() {
        let mut rates = HashMap::new();
        rates.insert(
            ("llmproxy".into(), "configured-model".into()),
            Rate {
                input: 2.0,
                output: 8.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );
        let mut invalid = row("llmproxy", "configured-model", 100.0, 10.0, "invalid", None);
        invalid.stored_cost = 1.5;
        invalid.tokens = None;

        let out = aggregate(&[invalid], &catalog(), &rates);

        assert_eq!(out[0].cost, 1.5);
        assert_eq!(out[0].source, CostSource::Stored);
        assert_eq!(out[0].models[0].source, CostSource::Stored);
    }

    #[test]
    fn model_usage_is_stored_regardless_of_message_order() {
        let mut rates = HashMap::new();
        rates.insert(
            ("llmproxy".into(), "configured-model".into()),
            Rate {
                input: 2.0,
                output: 8.0,
                cache_read: 0.0,
                cache_write: 0.0,
            },
        );
        let configured = row("llmproxy", "configured-model", 100.0, 10.0, "same", None);
        let mut stored = row("llmproxy", "configured-model", 100.0, 10.0, "same", None);
        stored.tokens = None;
        stored.stored_cost = 1.5;

        for rows in [
            vec![configured.clone(), stored.clone()],
            vec![stored, configured],
        ] {
            let out = aggregate(&rows, &catalog(), &rates);
            assert_eq!(out[0].models[0].source, CostSource::Stored);
        }
    }

    #[test]
    fn sessions_with_equal_dates_are_sorted_by_id() {
        let rows = vec![
            row("openrama", "stored-model", 0.0, 0.0, "z-session", None),
            row("openrama", "stored-model", 0.0, 0.0, "a-session", None),
        ];
        let out = aggregate(&rows, &catalog(), &HashMap::new());

        assert_eq!(
            out.iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            ["a-session", "z-session"]
        );
    }

    #[test]
    fn models_are_sorted_by_provider_and_model() {
        let rows = vec![
            row("z-provider", "z-model", 0.0, 0.0, "session", None),
            row("a-provider", "z-model", 0.0, 0.0, "session", None),
            row("a-provider", "a-model", 0.0, 0.0, "session", None),
        ];
        let out = aggregate(&rows, &catalog(), &HashMap::new());

        let models = out[0]
            .models
            .iter()
            .map(|model| (model.provider.as_str(), model.model.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            models,
            [
                ("a-provider", "a-model"),
                ("a-provider", "z-model"),
                ("z-provider", "z-model")
            ]
        );
    }
}
