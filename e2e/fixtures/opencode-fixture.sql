-- fixture-id: e2e-sql-v1
-- Source SQL versionnée pour les scénarios E2E. Elle ne représente jamais la base utilisateur.
PRAGMA user_version = 1;

CREATE TABLE session_fixture (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cost REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL
);

INSERT INTO session_fixture (
  id, title, project, created_at, cost, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, reasoning_tokens
) VALUES
  ('today', 'Boundary fixture session', '/fixtures/e2e', '2026-09-27T12:00:00Z', 12.34, 1000, 200, 30, 4, 5),
  ('outside', 'Outside fixture session', '/fixtures/e2e', '2026-09-19T12:00:00Z', 5.67, 500, 100, 10, 2, 3);
