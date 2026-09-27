use opencode_costs_viewer_lib::config::extract_rates;
use opencode_costs_viewer_lib::cost::Rate;
use opencode_costs_viewer_lib::jsonc::{strip_comments, strip_trailing_commas};
use opencode_costs_viewer_lib::pricing::{validate_catalog, PricingCatalog, PricingRate};
use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};

const REFERENCE_SQL: &str = include_str!("fixtures/audit/reference.sql");
const REFERENCE_CONFIG: &str = include_str!("fixtures/audit/reference-config.jsonc");
const REFERENCE_CATALOG: &str = include_str!("fixtures/audit/reference-catalog.json");
const REFERENCE_EXPECTED: &str = include_str!("fixtures/audit/reference-expected.json");

#[derive(Debug)]
enum RawJson {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object(Vec<(String, RawJson)>),
}

impl<'de> Deserialize<'de> for RawJson {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RawJsonVisitor;

        impl<'de> Visitor<'de> for RawJsonVisitor {
            type Value = RawJson;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("any JSON value")
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(RawJson::Null)
            }

            fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let _ = value;
                Ok(RawJson::Bool)
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let _ = value;
                Ok(RawJson::Number)
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let _ = value;
                Ok(RawJson::Number)
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value.is_finite() {
                    Ok(RawJson::Number)
                } else {
                    Err(E::custom("non-finite JSON number"))
                }
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let _ = value;
                Ok(RawJson::String)
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let _ = value;
                Ok(RawJson::String)
            }

            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                while let Some(_value) = sequence.next_element::<RawJson>()? {}
                Ok(RawJson::Array)
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut entries = Vec::new();
                while let Some((key, value)) = map.next_entry()? {
                    entries.push((key, value));
                }
                Ok(RawJson::Object(entries))
            }
        }

        deserializer.deserialize_any(RawJsonVisitor)
    }
}

#[derive(Debug, Clone)]
struct SourceSession {
    directory: String,
    title: String,
    parent_id: Option<String>,
}

#[derive(Debug, Clone)]
struct SourceMessage {
    session_id: String,
    directory: String,
    title: String,
    parent_id: Option<String>,
    role: String,
    provider: String,
    model: String,
    message_date: Value,
    tokens: Value,
    stored_cost: Value,
}

fn object_values<'a>(value: &'a RawJson, key: &str) -> Vec<&'a RawJson> {
    match value {
        RawJson::Object(entries) => entries
            .iter()
            .filter_map(|(entry_key, entry_value)| (entry_key == key).then_some(entry_value))
            .collect(),
        _ => Vec::new(),
    }
}

fn custom_rate_count(root: &RawJson) -> usize {
    object_values(root, "provider")
        .into_iter()
        .flat_map(|providers| match providers {
            RawJson::Object(entries) => entries.iter().map(|(_, value)| value).collect(),
            _ => Vec::new(),
        })
        .flat_map(|provider| object_values(provider, "models"))
        .flat_map(|models| match models {
            RawJson::Object(entries) => entries.iter().map(|(_, value)| value).collect(),
            _ => Vec::new(),
        })
        .flat_map(|model| object_values(model, "cost"))
        .count()
}

fn assert_exactly_one_custom_rate(cleaned_json: &str) -> Result<(), String> {
    let root: RawJson = serde_json::from_str(cleaned_json)
        .map_err(|error| format!("cleaned configuration is not valid JSON: {error}"))?;
    let count = custom_rate_count(&root);
    if count == 1 {
        Ok(())
    } else {
        Err(format!(
            "expected exactly one custom rate entry, found {count}"
        ))
    }
}

fn normalized_message_date(value: SqlValue) -> Value {
    match value {
        SqlValue::Integer(value) => json!(value),
        _ => Value::Null,
    }
}

fn json_optional_string(value: &Option<String>) -> Value {
    value
        .as_ref()
        .map(|value| Value::String(value.clone()))
        .unwrap_or(Value::Null)
}

fn source_tokens(data: &Value) -> Value {
    let Some(tokens) = data.get("tokens") else {
        return Value::Null;
    };
    let cache = tokens.get("cache").unwrap_or(&Value::Null);
    json!({
        "input": tokens.get("input").cloned().unwrap_or(Value::Null),
        "output": tokens.get("output").cloned().unwrap_or(Value::Null),
        "cacheRead": cache.get("read").cloned().unwrap_or(Value::Null),
        "cacheWrite": cache.get("write").cloned().unwrap_or(Value::Null),
        "reasoning": tokens.get("reasoning").cloned().unwrap_or(Value::Null),
    })
}

fn source_sessions(connection: &Connection) -> BTreeMap<String, SourceSession> {
    let mut statement = connection
        .prepare("SELECT id, directory, title, parent_id FROM session ORDER BY id")
        .expect("prepare source session query");
    statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                SourceSession {
                    directory: row.get(1)?,
                    title: row.get(2)?,
                    parent_id: row.get(3)?,
                },
            ))
        })
        .expect("query source sessions")
        .map(|row| row.expect("read source session"))
        .collect()
}

fn source_messages(
    connection: &Connection,
    sessions: &BTreeMap<String, SourceSession>,
) -> BTreeMap<String, SourceMessage> {
    let mut statement = connection
        .prepare("SELECT id, session_id, time_created, data FROM message ORDER BY id")
        .expect("prepare source message query");
    let rows = statement
        .query_map([], |row| {
            let data: String = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, SqlValue>(2)?,
                serde_json::from_str::<Value>(&data).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
            ))
        })
        .expect("query source messages");

    rows.map(|row| {
        let (message_id, session_id, time_created, data) = row.expect("read source message");
        let session = sessions
            .get(&session_id)
            .unwrap_or_else(|| panic!("source message {message_id} references unknown session"));
        let message = SourceMessage {
            session_id,
            directory: session.directory.clone(),
            title: session.title.clone(),
            parent_id: session.parent_id.clone(),
            role: data["role"]
                .as_str()
                .expect("source message role")
                .to_owned(),
            provider: data["providerID"]
                .as_str()
                .expect("source message provider")
                .to_owned(),
            model: data["modelID"]
                .as_str()
                .expect("source message model")
                .to_owned(),
            message_date: normalized_message_date(time_created),
            tokens: source_tokens(&data),
            stored_cost: data["cost"].clone(),
        };
        (message_id, message)
    })
    .collect()
}

fn objects_by_id(value: &Value, collection: &str, id_field: &str) -> BTreeMap<String, Value> {
    let mut objects = BTreeMap::new();
    for object in value[collection]
        .as_array()
        .unwrap_or_else(|| panic!("expected {collection} array"))
    {
        let id = object[id_field]
            .as_str()
            .expect("expected object ID")
            .to_owned();
        assert!(
            objects.insert(id, object.clone()).is_none(),
            "duplicate oracle ID"
        );
    }
    objects
}

fn sorted_ids<T>(objects: &BTreeMap<String, T>) -> Vec<String> {
    let mut ids = objects.keys().cloned().collect::<Vec<_>>();
    ids.sort();
    ids
}

fn ordered_ids(value: &Value, collection: &str, id_field: &str) -> Vec<String> {
    value[collection]
        .as_array()
        .unwrap_or_else(|| panic!("expected {collection} array"))
        .iter()
        .map(|object| {
            object[id_field]
                .as_str()
                .expect("expected ordered object ID")
                .to_owned()
        })
        .collect()
}

fn sorted(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values
}

fn source_token_total(messages: &BTreeMap<String, SourceMessage>, field: &str) -> i64 {
    messages
        .values()
        .filter(|message| message.role == "assistant")
        .filter_map(|message| message.tokens[field].as_i64())
        .sum()
}

#[derive(Debug, Clone, Copy)]
struct FixtureTokens {
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    reasoning: i64,
}

#[derive(Debug, Clone, Copy)]
struct FixtureRate {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

#[derive(Debug, Clone)]
struct ResolvedFixtureRate {
    rate: FixtureRate,
    source: &'static str,
    effective_from: Option<String>,
}

fn fixture_tokens(value: &Value) -> Option<FixtureTokens> {
    let input = value.get("input")?.as_i64()?;
    let output = value.get("output")?.as_i64()?;
    let cache_read = value.get("cacheRead")?.as_i64()?;
    let cache_write = value.get("cacheWrite")?.as_i64()?;
    let reasoning = value.get("reasoning")?.as_i64()?;
    (input >= 0 && output >= 0 && cache_read >= 0 && cache_write >= 0 && reasoning >= 0).then_some(
        FixtureTokens {
            input,
            output,
            cache_read,
            cache_write,
            reasoning,
        },
    )
}

fn fixture_rate(rate: Rate) -> FixtureRate {
    FixtureRate {
        input: rate.input,
        output: rate.output,
        cache_read: rate.cache_read,
        cache_write: rate.cache_write,
    }
}

fn fixture_catalog_rate(rate: &PricingRate) -> FixtureRate {
    FixtureRate {
        input: rate.input,
        output: rate.output,
        cache_read: rate.cache_read,
        cache_write: rate.cache_write,
    }
}

fn fixture_resolved_rate(
    message: &SourceMessage,
    custom_rates: &HashMap<(String, String), Rate>,
    catalog: &PricingCatalog,
) -> Option<ResolvedFixtureRate> {
    if let Some(rate) = custom_rates.get(&(message.provider.clone(), message.model.clone())) {
        return Some(ResolvedFixtureRate {
            rate: fixture_rate(*rate),
            source: "configured",
            effective_from: None,
        });
    }

    let message_date = message.message_date.as_i64()?;
    catalog
        .rates
        .iter()
        .filter(|rate| rate.provider == message.provider && rate.model == message.model)
        .filter_map(|rate| {
            let effective_date = chrono::DateTime::parse_from_rfc3339(&rate.effective_from)
                .ok()?
                .timestamp_millis();
            (effective_date <= message_date).then_some((effective_date, rate))
        })
        .max_by_key(|(effective_date, _)| *effective_date)
        .map(|(_, rate)| ResolvedFixtureRate {
            rate: fixture_catalog_rate(rate),
            source: "catalog",
            effective_from: Some(rate.effective_from.clone()),
        })
}

fn manual_fixture_breakdown(tokens: FixtureTokens, rate: FixtureRate) -> Value {
    let per_million = 1_000_000.0;
    let input = tokens.input as f64 * rate.input / per_million;
    let output = tokens.output as f64 * rate.output / per_million;
    let cache_read = tokens.cache_read as f64 * rate.cache_read / per_million;
    let cache_write = tokens.cache_write as f64 * rate.cache_write / per_million;
    let reasoning = tokens.reasoning as f64 * rate.output / per_million;
    json!({
        "input": input,
        "output": output,
        "cacheRead": cache_read,
        "cacheWrite": cache_write,
        "reasoning": reasoning,
        "total": input + output + cache_read + cache_write + reasoning,
    })
}

fn manual_fixture_cost(tokens: FixtureTokens, rate: FixtureRate) -> f64 {
    manual_fixture_breakdown(tokens, rate)["total"]
        .as_f64()
        .expect("manual fixture total is numeric")
}

fn independent_summary(
    sessions: &BTreeMap<String, SourceSession>,
    messages: &BTreeMap<String, SourceMessage>,
    custom_rates: &HashMap<(String, String), Rate>,
    catalog: &PricingCatalog,
) -> Value {
    let assistant_messages = messages
        .values()
        .filter(|message| message.role == "assistant")
        .collect::<Vec<_>>();
    let mut recalculable_messages = 0;
    let mut custom_rate_messages = 0;
    let mut catalog_rate_messages = 0;
    let mut stored_fallback_messages = 0;
    let mut missing_token_messages = 0;
    let mut missing_date_messages = 0;
    let mut missing_rate_messages = 0;
    let mut stored_cost_total = 0.0;
    let mut calculated_cost_total = 0.0;
    let mut selected_cost_total = 0.0;

    for message in assistant_messages.iter().copied() {
        let stored_cost = message
            .stored_cost
            .as_f64()
            .expect("assistant stored cost is numeric in source");
        let tokens = fixture_tokens(&message.tokens);
        let resolved_rate = fixture_resolved_rate(message, custom_rates, catalog);
        stored_cost_total += stored_cost;

        if tokens.is_none() {
            missing_token_messages += 1;
        }
        if message.message_date.as_i64().is_none() {
            missing_date_messages += 1;
        }
        match resolved_rate.as_ref() {
            Some(rate) if rate.source == "configured" => custom_rate_messages += 1,
            Some(rate) if rate.source == "catalog" => catalog_rate_messages += 1,
            Some(_) => unreachable!("fixture rate source is known"),
            None => missing_rate_messages += 1,
        }

        if let (Some(tokens), Some(rate)) = (tokens, resolved_rate.as_ref()) {
            let calculated_cost = manual_fixture_cost(tokens, rate.rate);
            recalculable_messages += 1;
            calculated_cost_total += calculated_cost;
            selected_cost_total += calculated_cost;
        } else {
            stored_fallback_messages += 1;
            selected_cost_total += stored_cost;
        }
    }

    let sessions_with_assistant = assistant_messages
        .iter()
        .map(|message| message.session_id.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let user_messages = messages
        .values()
        .filter(|message| message.role == "user")
        .count();

    json!({
        "allSessions": sessions.len(),
        "totalMessages": messages.len(),
        "sessionsWithAssistant": sessions_with_assistant,
        "assistantMessages": assistant_messages.len(),
        "ignoredMessages": user_messages,
        "recalculableMessages": recalculable_messages,
        "customRateMessages": custom_rate_messages,
        "catalogRateMessages": catalog_rate_messages,
        "storedFallbackMessages": stored_fallback_messages,
         "missingTokenMessages": missing_token_messages,
         "missingDateMessages": missing_date_messages,
         "missingRateMessages": missing_rate_messages,
        "storedCostTotal": stored_cost_total,
        "calculatedCostTotal": calculated_cost_total,
        "selectedCostTotal": selected_cost_total,
        "tokens": {
            "input": source_token_total(messages, "input"),
            "output": source_token_total(messages, "output"),
            "cacheRead": source_token_total(messages, "cacheRead"),
            "cacheWrite": source_token_total(messages, "cacheWrite"),
            "reasoning": source_token_total(messages, "reasoning"),
        },
        "anomalyCounts": {
             "missingTokens": missing_token_messages,
             "missingDate": missing_date_messages,
             "missingRate": missing_rate_messages,
             "invalidRate": 0,
             "storedCostFallback": stored_fallback_messages,
        },
    })
}

#[test]
fn audit_reference_fixtures_have_exact_source_schema_and_rows() {
    let connection = Connection::open_in_memory().expect("open in-memory fixture database");
    connection
        .execute_batch(REFERENCE_SQL)
        .expect("reference SQL is executable");

    let mut tables: Vec<String> = connection
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .expect("prepare table query")
        .query_map([], |row| row.get(0))
        .expect("query tables")
        .collect::<Result<_, _>>()
        .expect("read table names");
    tables.sort();
    assert_eq!(tables, vec!["message", "session"]);

    let objects: Vec<(String, String, String)> = connection
        .prepare("SELECT type, name, tbl_name FROM sqlite_schema")
        .expect("prepare sqlite schema object query")
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("query sqlite schema objects")
        .collect::<Result<_, _>>()
        .expect("read sqlite schema objects");
    let user_objects = objects
        .iter()
        .filter(|(object_type, name, _)| {
            !(object_type == "index" && name.starts_with("sqlite_autoindex_"))
        })
        .collect::<Vec<_>>();
    assert_eq!(
        user_objects
            .iter()
            .map(|(object_type, name, table)| {
                (object_type.as_str(), name.as_str(), table.as_str())
            })
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            ("table", "message", "message"),
            ("table", "session", "session"),
        ])
    );

    let schema = |table: &str| -> Vec<(String, String, i64, i64)> {
        connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("prepare schema query")
            .query_map([], |row| {
                Ok((row.get(1)?, row.get(2)?, row.get(3)?, row.get(5)?))
            })
            .expect("query schema")
            .collect::<Result<_, _>>()
            .expect("read schema")
    };
    assert_eq!(
        schema("session"),
        vec![
            ("id".into(), "TEXT".into(), 0, 1),
            ("directory".into(), "TEXT".into(), 1, 0),
            ("title".into(), "TEXT".into(), 1, 0),
            ("parent_id".into(), "TEXT".into(), 0, 0),
            ("time_created".into(), "INTEGER".into(), 1, 0),
        ]
    );
    assert_eq!(
        schema("message"),
        vec![
            ("id".into(), "TEXT".into(), 0, 1),
            ("session_id".into(), "TEXT".into(), 1, 0),
            ("time_created".into(), "".into(), 0, 0),
            ("time_updated".into(), "INTEGER".into(), 1, 0),
            ("data".into(), "TEXT".into(), 1, 0),
        ]
    );

    let sessions = source_sessions(&connection);
    let messages = source_messages(&connection, &sessions);
    assert_eq!(sessions.len(), 7);
    assert_eq!(messages.len(), 10);

    let rates = extract_rates(REFERENCE_CONFIG).expect("reference config is valid JSONC");
    assert!(REFERENCE_CONFIG.contains("// Fixed custom rate to verify catalog priority."));
    assert!(REFERENCE_CONFIG.contains("\"cache_write\": 1.5,"));
    let cleaned_config = strip_trailing_commas(&strip_comments(REFERENCE_CONFIG));
    assert_exactly_one_custom_rate(&cleaned_config)
        .expect("reference config must contain exactly one custom rate before parsing");
    assert_eq!(
        rates.len(),
        1,
        "reference config must contain exactly one custom rate"
    );
    let custom_rate = rates
        .get(&(
            String::from("fixture-custom"),
            String::from("fixture-model"),
        ))
        .expect("custom fixture rate exists");
    assert_eq!(custom_rate.input, 2.0);
    assert_eq!(custom_rate.output, 8.0);
    assert_eq!(custom_rate.cache_read, 0.5);
    assert_eq!(custom_rate.cache_write, 1.5);

    let catalog = validate_catalog(REFERENCE_CATALOG).expect("reference catalog is valid");
    assert_eq!(catalog.version, 1);
    assert_eq!(catalog.generated_at, "2026-09-25T00:00:00Z");
    assert_eq!(catalog.source_version, "audit-fixture-1");
    assert_eq!(catalog.rates.len(), 2);
    assert_eq!(
        catalog
            .rates
            .iter()
            .map(|rate| (
                rate.provider.as_str(),
                rate.model.as_str(),
                rate.effective_from.as_str(),
                rate.input,
                rate.output,
                rate.cache_read,
                rate.cache_write,
                rate.source.as_str(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                "fixture-history",
                "fixture-model",
                "2025-01-01T00:00:00Z",
                1.0,
                2.0,
                0.0,
                0.0,
                "fixture"
            ),
            (
                "fixture-history",
                "fixture-model",
                "2026-01-01T00:00:00Z",
                3.0,
                4.0,
                0.0,
                0.0,
                "fixture"
            ),
        ]
    );
}

#[test]
fn duplicate_custom_rates_are_rejected_before_production_parsing() {
    let duplicate_config = r#"
    {
      "provider": {
        "fixture-custom": {
          "models": {
            "fixture-model": {"cost": {"input": 2.0}},
            "fixture-model": {"cost": {"input": 3.0}}
          }
        }
      }
    }
    "#;
    let cleaned_config = strip_trailing_commas(&strip_comments(duplicate_config));

    assert!(
        assert_exactly_one_custom_rate(&cleaned_config).is_err(),
        "duplicate custom-rate entries must be rejected independently of the production parser"
    );
}

#[test]
fn audit_reference_expected_is_linked_to_sql_source() {
    let expected_json = strip_trailing_commas(&strip_comments(REFERENCE_EXPECTED));
    let expected: Value =
        serde_json::from_str(&expected_json).expect("reference expected output is valid JSON");

    let source = Connection::open_in_memory().expect("open source fixture database");
    source
        .execute_batch(REFERENCE_SQL)
        .expect("reference SQL is executable");
    let source_sessions = source_sessions(&source);
    let source_messages = source_messages(&source, &source_sessions);
    let expected_messages = objects_by_id(&expected, "messages", "messageId");
    let expected_ignored = objects_by_id(&expected, "ignored", "messageId");
    let expected_sessions = objects_by_id(&expected, "sessions", "sessionId");
    let custom_rates = extract_rates(REFERENCE_CONFIG).expect("reference config is valid JSONC");
    let catalog = validate_catalog(REFERENCE_CATALOG).expect("reference catalog is valid");

    let expected_message_ids = ordered_ids(&expected, "messages", "messageId");
    assert_eq!(
        expected_message_ids,
        sorted(expected_message_ids.clone()),
        "messages must use the canonical messageId order"
    );
    let expected_ignored_ids = ordered_ids(&expected, "ignored", "messageId");
    assert_eq!(
        expected_ignored_ids,
        sorted(expected_ignored_ids.clone()),
        "ignored messages must use the canonical messageId order"
    );
    let expected_session_ids = ordered_ids(&expected, "sessions", "sessionId");
    assert_eq!(
        expected_session_ids,
        sorted(expected_session_ids.clone()),
        "sessions must use the canonical sessionId order"
    );

    let mut source_assistant_ids = source_messages
        .iter()
        .filter(|(_, message)| message.role == "assistant")
        .map(|(message_id, _)| message_id.clone())
        .collect::<Vec<_>>();
    source_assistant_ids.sort();
    assert_eq!(sorted_ids(&expected_messages), source_assistant_ids);
    assert_eq!(expected_message_ids, source_assistant_ids);

    let mut source_ignored_ids = source_messages
        .iter()
        .filter(|(_, message)| message.role != "assistant")
        .map(|(message_id, _)| message_id.clone())
        .collect::<Vec<_>>();
    source_ignored_ids.sort();
    assert_eq!(expected_ignored_ids, source_ignored_ids);
    assert_eq!(expected_session_ids, sorted_ids(&source_sessions));

    let summary = independent_summary(&source_sessions, &source_messages, &custom_rates, &catalog);
    assert_eq!(expected["summary"], summary);

    for (message_id, detail) in &expected_messages {
        let source_message = source_messages
            .get(message_id)
            .expect("expected assistant message exists in SQL source");
        assert_eq!(source_message.role, "assistant");
        assert_eq!(detail["sessionId"], source_message.session_id);
        assert_eq!(detail["project"], source_message.directory);
        assert_eq!(detail["provider"], source_message.provider);
        assert_eq!(detail["model"], source_message.model);
        assert_eq!(detail["messageDate"], source_message.message_date);
        assert_eq!(detail["tokens"], source_message.tokens);
        assert_eq!(detail["storedCost"], source_message.stored_cost);

        let tokens = fixture_tokens(&source_message.tokens);
        let resolved_rate = fixture_resolved_rate(source_message, &custom_rates, &catalog);
        let mut anomalies = Vec::new();
        if tokens.is_none() {
            anomalies.push("missingTokens");
        }
        if source_message.message_date.as_i64().is_none() {
            anomalies.push("missingDate");
        }
        if resolved_rate.is_none() {
            anomalies.push("missingRate");
        }
        if tokens.is_none() || resolved_rate.is_none() {
            anomalies.push("storedCostFallback");
        }
        assert_eq!(detail["anomalies"], json!(anomalies));

        match resolved_rate.as_ref() {
            Some(rate) => {
                assert_eq!(detail["rateSource"], rate.source);
                assert_eq!(
                    detail["effectiveFrom"],
                    rate.effective_from
                        .as_ref()
                        .map(|effective_from| json!(effective_from))
                        .unwrap_or(Value::Null)
                );
                assert_eq!(
                    detail["rate"],
                    json!({
                        "input": rate.rate.input,
                        "output": rate.rate.output,
                        "cacheRead": rate.rate.cache_read,
                        "cacheWrite": rate.rate.cache_write,
                    })
                );
            }
            None => {
                assert_eq!(detail["rateSource"], Value::Null);
                assert_eq!(detail["effectiveFrom"], Value::Null);
                assert_eq!(detail["rate"], Value::Null);
            }
        }

        match (tokens, resolved_rate.as_ref()) {
            (Some(tokens), Some(rate)) => {
                let breakdown = manual_fixture_breakdown(tokens, rate.rate);
                assert_eq!(detail["calculatedCost"], breakdown["total"]);
                assert_eq!(detail["selectedCost"], breakdown["total"]);
                assert_eq!(detail["costSource"], rate.source);
                assert_eq!(detail["breakdown"], breakdown);
            }
            _ => {
                assert_eq!(detail["calculatedCost"], Value::Null);
                assert_eq!(detail["selectedCost"], source_message.stored_cost);
                assert_eq!(detail["costSource"], "stored");
                assert_eq!(detail["breakdown"], Value::Null);
            }
        }

        let expected_session = expected_sessions
            .get(&source_message.session_id)
            .expect("expected session exists for assistant message");
        assert_eq!(expected_session["sessionId"], source_message.session_id);
        assert_eq!(expected_session["project"], source_message.directory);
        assert_eq!(expected_session["title"], source_message.title);
        assert_eq!(
            expected_session["parentId"],
            json_optional_string(&source_message.parent_id)
        );
    }

    let mut expected_ignored_tuples = BTreeMap::new();
    for (message_id, detail) in &expected_ignored {
        assert_eq!(detail["reason"], "nonAssistant");
        let source_message = source_messages
            .get(message_id)
            .expect("expected ignored message exists in SQL source");
        let expected_tuple = (
            detail["sessionId"]
                .as_str()
                .expect("expected ignored session ID")
                .to_owned(),
            detail["role"]
                .as_str()
                .expect("expected ignored role")
                .to_owned(),
        );
        let source_tuple = (
            source_message.session_id.clone(),
            source_message.role.clone(),
        );
        assert_eq!(expected_tuple, source_tuple);
        assert_eq!(source_message.role, "user");
        assert!(expected_ignored_tuples
            .insert(message_id.clone(), expected_tuple)
            .is_none());
    }
    let source_user_tuples = source_messages
        .iter()
        .filter(|(_, message)| message.role == "user")
        .map(|(message_id, message)| {
            (
                message_id.clone(),
                (message.session_id.clone(), message.role.clone()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(expected_ignored_tuples, source_user_tuples);

    assert_eq!(expected_session_ids, sorted_ids(&source_sessions));
    for (session_id, expected_session) in &expected_sessions {
        let source_session = source_sessions
            .get(session_id)
            .expect("expected session exists in SQL source");
        assert_eq!(expected_session["sessionId"], json!(session_id));
        assert_eq!(expected_session["project"], source_session.directory);
        assert_eq!(expected_session["title"], source_session.title);
        assert_eq!(
            expected_session["parentId"],
            json_optional_string(&source_session.parent_id)
        );

        let expected_message_ids = expected_session["messageIds"]
            .as_array()
            .expect("expected session message IDs")
            .iter()
            .map(|message_id| {
                message_id
                    .as_str()
                    .expect("expected session message ID")
                    .to_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            expected_message_ids,
            sorted(expected_message_ids.clone()),
            "session messageIds must use the canonical messageId order"
        );
        let mut source_message_ids = source_messages
            .iter()
            .filter(|(_, message)| message.session_id == *session_id && message.role == "assistant")
            .map(|(message_id, _)| message_id.clone())
            .collect::<Vec<_>>();
        source_message_ids.sort();
        assert_eq!(expected_message_ids, source_message_ids);
        assert_eq!(
            expected_session["assistantMessages"],
            source_message_ids.len()
        );
    }

    assert_eq!(expected["valid"], true);
    assert_eq!(expected["invariants"]["valid"], true);
    assert_eq!(expected["invariants"]["failed"], json!([]));
}
