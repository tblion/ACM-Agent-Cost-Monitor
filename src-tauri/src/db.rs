use crate::aggregate::RawRow;
use crate::audit::{IgnoredRow, SessionRow};
use crate::model::{CostSummary, Tokens};
use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;

/// Default path for the opencode database.
/// opencode uses the XDG convention (including on Windows):
/// $XDG_DATA_HOME/opencode/opencode.db or ~/.local/share/opencode/opencode.db
pub fn default_db_path() -> PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(".local").join("share"));
    base.join("opencode").join("opencode.db")
}

pub fn load_rows(db_path: &str) -> Result<Vec<RawRow>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Impossible d'ouvrir la base: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    load_rows_from_connection(&conn)
}

fn load_rows_from_connection(conn: &Connection) -> Result<Vec<RawRow>, String> {
    let mut stmt = conn.prepare(
        "SELECT s.directory, m.id, s.id, s.title, s.parent_id, s.time_created, m.time_created, m.data \
         FROM session s JOIN message m ON m.session_id = s.id \
         WHERE json_extract(m.data, '$.role') = 'assistant'")
        .map_err(|e| format!("Requete impossible (schema inattendu?): {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            let message_time = match r.get::<_, Value>(6)? {
                Value::Integer(value) => Some(value),
                Value::Null | Value::Real(_) | Value::Text(_) | Value::Blob(_) => None,
            };
            let data: String = r.get(7)?;
            let v: serde_json::Value = serde_json::from_str(&data).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    7,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            let tokens = parse_tokens(v.get("tokens"));
            Ok(RawRow {
                project: r.get(0)?,
                message_id: r.get(1)?,
                session_id: r.get(2)?,
                title: r.get(3)?,
                parent_id: r.get(4)?,
                date: r.get(5)?,
                message_date: message_time,
                provider: v
                    .get("providerID")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                model: v
                    .get("modelID")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                stored_cost: v.get("cost").and_then(|x| x.as_f64()).unwrap_or(0.0),
                tokens,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Ligne illisible: {e}"))?);
    }
    Ok(out)
}

pub fn count_sessions(db_path: &str) -> Result<u64, String> {
    count_rows(db_path, "session")
}

pub fn count_messages(db_path: &str) -> Result<u64, String> {
    count_rows(db_path, "message")
}

#[derive(Debug)]
pub struct AuditSnapshot {
    pub rows: Vec<RawRow>,
    pub ignored_rows: Vec<IgnoredRow>,
    pub session_rows: Vec<SessionRow>,
    pub total_sessions: u64,
    pub total_messages: u64,
}

pub fn load_audit_snapshot(db_path: &str) -> Result<AuditSnapshot, String> {
    let mut connection = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Impossible d'ouvrir la base: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Snapshot SQLite impossible: {error}"))?;

    let rows = load_rows_from_connection(&transaction)?;
    let total_sessions = count_rows_from_connection(&transaction, "session")?;
    let total_messages = count_rows_from_connection(&transaction, "message")?;
    let session_rows = load_session_rows(&transaction)?;
    let ignored_rows = load_ignored_rows(&transaction)?;

    transaction
        .commit()
        .map_err(|error| format!("Validation du snapshot SQLite impossible: {error}"))?;

    Ok(AuditSnapshot {
        rows,
        ignored_rows,
        session_rows,
        total_sessions,
        total_messages,
    })
}

fn count_rows(db_path: &str, table: &str) -> Result<u64, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Impossible d'ouvrir la base: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    count_rows_from_connection(&conn, table)
}

fn count_rows_from_connection(conn: &Connection, table: &str) -> Result<u64, String> {
    let count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .map_err(|e| format!("Requete impossible (schema inattendu?): {e}"))?;
    u64::try_from(count).map_err(|e| format!("Nombre de lignes invalide: {e}"))
}

fn load_session_rows(conn: &Connection) -> Result<Vec<SessionRow>, String> {
    let mut statement = conn
        .prepare("SELECT id, directory, title, parent_id FROM session ORDER BY id")
        .map_err(|error| format!("Requete impossible (schema inattendu?): {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(SessionRow {
                session_id: row.get(0)?,
                project: row.get(1)?,
                title: row.get(2)?,
                parent_id: row.get(3)?,
            })
        })
        .map_err(|error| format!("Lecture des sessions impossible: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Ligne de session illisible: {error}"))?;
    Ok(rows)
}

fn load_ignored_rows(conn: &Connection) -> Result<Vec<IgnoredRow>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, session_id, COALESCE(json_extract(data, '$.role'), '')
             FROM message
             WHERE COALESCE(json_extract(data, '$.role'), '') <> 'assistant'
             ORDER BY id",
        )
        .map_err(|error| format!("Requete impossible (schema inattendu?): {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(IgnoredRow {
                message_id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
            })
        })
        .map_err(|error| format!("Lecture des messages ignores impossible: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Ligne de message ignoree illisible: {error}"))?;
    Ok(rows)
}

fn parse_tokens(value: Option<&serde_json::Value>) -> Option<Tokens> {
    let object = value?.as_object()?;
    let number = |value: Option<&serde_json::Value>| {
        value
            .and_then(serde_json::Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
    };
    Some(Tokens {
        input: number(object.get("input"))?,
        output: number(object.get("output"))?,
        cache_read: number(object.get("cache").and_then(|cache| cache.get("read")))?,
        cache_write: number(object.get("cache").and_then(|cache| cache.get("write")))?,
        reasoning: number(object.get("reasoning"))?,
    })
}

pub fn load_cost_summary(db_path: &str) -> Result<Vec<CostSummary>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Impossible d'ouvrir la base: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(json_extract(m.data, '$.providerID'), ''),
                COALESCE(json_extract(m.data, '$.modelID'), ''),
                COUNT(CASE WHEN json_extract(m.data, '$.cost') > 0 THEN 1 END),
                COALESCE(SUM(CASE WHEN json_extract(m.data, '$.cost') > 0
                                  THEN json_extract(m.data, '$.cost') ELSE 0 END), 0)
         FROM message m
         WHERE json_extract(m.data, '$.role') = 'assistant'
         GROUP BY json_extract(m.data, '$.providerID'), json_extract(m.data, '$.modelID')
         HAVING SUM(CASE WHEN json_extract(m.data, '$.cost') > 0
                         THEN json_extract(m.data, '$.cost') ELSE 0 END) > 0
         ORDER BY 1, 2",
        )
        .map_err(|e| format!("Requete impossible (schema inattendu?): {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CostSummary {
                provider: r.get(0)?,
                model: r.get(1)?,
                messages: r.get::<_, i64>(2)?.try_into().map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Integer,
                        Box::new(e),
                    )
                })?,
                stored_cost: r.get(3)?,
                configured: false,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Ligne illisible: {e}"))?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs::{self, OpenOptions};
    use std::ops::Deref;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMPORARY_DATABASE: AtomicU64 = AtomicU64::new(0);

    struct TemporaryDatabase {
        path: std::path::PathBuf,
    }

    impl Deref for TemporaryDatabase {
        type Target = std::path::Path;

        fn deref(&self) -> &Self::Target {
            &self.path
        }
    }

    impl AsRef<std::path::Path> for TemporaryDatabase {
        fn as_ref(&self) -> &std::path::Path {
            &self.path
        }
    }

    impl Drop for TemporaryDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn temp_db_path() -> TemporaryDatabase {
        let directory = std::env::temp_dir();
        for attempt in 0..100 {
            let counter = NEXT_TEMPORARY_DATABASE.fetch_add(1, Ordering::Relaxed);
            let path = directory.join(format!(
                "opencode-cost-summary-{}-{counter}-{attempt}.db",
                std::process::id()
            ));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => {
                    drop(file);
                    return TemporaryDatabase { path };
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create unique temporary database failed: {error}"),
            }
        }
        panic!("could not reserve a unique temporary database path");
    }

    #[test]
    fn cost_summary_counts_positive_assistant_costs_by_model() {
        let path = temp_db_path();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE message (data TEXT NOT NULL);
             INSERT INTO message (data) VALUES
               ('{\"role\":\"assistant\",\"providerID\":\"p1\",\"modelID\":\"m1\",\"cost\":2.5}'),
               ('{\"role\":\"assistant\",\"providerID\":\"p1\",\"modelID\":\"m1\",\"cost\":0}'),
               ('{\"role\":\"assistant\",\"providerID\":\"p2\",\"modelID\":\"m2\",\"cost\":1.25}'),
               ('{\"role\":\"assistant\",\"providerID\":\"p2\",\"modelID\":\"m2\",\"cost\":0}'),
               ('{\"role\":\"assistant\",\"providerID\":\"p3\",\"modelID\":\"zero-only\",\"cost\":0}'),
               ('{\"role\":\"user\",\"providerID\":\"p1\",\"modelID\":\"m1\",\"cost\":99}')",
        ).unwrap();
        drop(conn);

        let summaries = load_cost_summary(path.to_str().unwrap()).unwrap();

        assert_eq!(summaries.len(), 2);
        let m1 = summaries.iter().find(|s| s.model == "m1").unwrap();
        assert_eq!(m1.messages, 1);
        assert!((m1.stored_cost - 2.5).abs() < f64::EPSILON);
        assert_eq!(serde_json::to_value(m1).unwrap()["storedCost"], 2.5);
        assert_eq!(m1.configured, false);
        let m2 = summaries.iter().find(|s| s.model == "m2").unwrap();
        assert_eq!(m2.messages, 1);
        assert!((m2.stored_cost - 1.25).abs() < f64::EPSILON);
        assert!(summaries.iter().all(|s| s.model != "zero-only"));
    }

    #[test]
    fn load_rows_preserves_message_identity() {
        let path = temp_db_path();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, parent_id TEXT, time_created INTEGER NOT NULL);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER NOT NULL, data TEXT NOT NULL);
             INSERT INTO session VALUES ('s1', '/project', 'title', NULL, 1700000000000);
             INSERT INTO message VALUES ('m1', 's1', 1700000000001, '{\"role\":\"assistant\",\"providerID\":\"p\",\"modelID\":\"m\",\"cost\":1}');",
        )
        .unwrap();
        drop(conn);

        let rows = load_rows(path.to_str().unwrap()).unwrap();

        assert_eq!(rows[0].message_id, "m1");
    }

    #[test]
    fn read_only_counts_include_all_sessions_and_messages() {
        let path = temp_db_path();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session (id TEXT PRIMARY KEY);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT NOT NULL);
             INSERT INTO session VALUES ('s1'), ('s2');
             INSERT INTO message VALUES
               ('m1', 's1', '{\"role\":\"assistant\"}'),
               ('m2', 's1', '{\"role\":\"user\"}'),
               ('m3', 's2', '{\"role\":\"assistant\"}');",
        )
        .unwrap();
        drop(conn);

        assert_eq!(count_sessions(path.to_str().unwrap()).unwrap(), 2);
        assert_eq!(count_messages(path.to_str().unwrap()).unwrap(), 3);
    }

    #[test]
    fn invalid_or_empty_tokens_are_not_treated_as_zero_tokens() {
        assert!(parse_tokens(None).is_none());
        assert!(parse_tokens(Some(&serde_json::json!({}))).is_none());
        assert!(parse_tokens(Some(&serde_json::json!({
            "input": 1.0,
            "output": 2.0,
            "cache": {"read": 0.0, "write": 0.0},
            "reasoning": 0.0,
        })))
        .is_some());
    }
}
