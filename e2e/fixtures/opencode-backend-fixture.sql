CREATE TABLE session (
    id TEXT PRIMARY KEY,
    directory TEXT NOT NULL,
    title TEXT NOT NULL,
    parent_id TEXT,
    time_created INTEGER NOT NULL
);

CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    data TEXT NOT NULL
);

INSERT INTO session (id, directory, title, parent_id, time_created) VALUES
    ('session-parent', '/fixtures/native', 'Native fixture parent', NULL, 1790856000000),
    ('session-child', '/fixtures/native', 'Native fixture child', 'session-parent', 1790856600000),
    ('session-fallback', '/fixtures/native', 'Native stored fallback', NULL, 1790857200000);

INSERT INTO message (id, session_id, time_created, data) VALUES
    ('message-configured', 'session-parent', 1790856000000,
     '{"role":"assistant","providerID":"fixture-provider","modelID":"fixture-model","cost":8.0,"tokens":{"input":1000000,"output":500000,"cache":{"read":200000,"write":100000},"reasoning":10000}}'),
    ('message-child', 'session-child', 1790856600000,
     '{"role":"assistant","providerID":"fixture-provider","modelID":"fixture-model","cost":0.2,"tokens":{"input":100000,"output":0,"cache":{"read":0,"write":0},"reasoning":0}}'),
    ('message-fallback', 'session-fallback', 1790857200000,
     '{"role":"assistant","providerID":"local","modelID":"unknown-model","cost":0.75}'),
    ('message-user', 'session-parent', 1790856000000,
     '{"role":"user","providerID":"fixture-provider","modelID":"fixture-model"}');
