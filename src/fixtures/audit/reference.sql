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
  time_created,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
);

INSERT INTO session (id, directory, title, parent_id, time_created) VALUES
  ('s-custom', '/fixture/custom', 'Custom rates', NULL, 1735689600000),
  ('s-history', '/fixture/history', 'Historical rates', NULL, 1735603200000),
  ('s-fallback', '/fixture/fallback', 'Stored fallback', NULL, 1767225600000),
  ('s-invalid', '/fixture/invalid', 'Invalid source data', NULL, 1767312000000),
  ('s-parent', '/fixture/parent', 'Parent session', NULL, 1767398400000),
  ('s-child', '/fixture/parent', 'Child session', 's-parent', 1767484800000),
  ('s-empty', '/fixture/empty', 'Empty session', NULL, 1767571200000);

INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES
  ('m-custom', 's-custom', 1735689601000, 1735689601001,
   '{"role":"assistant","providerID":"fixture-custom","modelID":"fixture-model","cost":99.0,"tokens":{"input":1000000,"output":1000000,"cache":{"read":1000000,"write":1000000},"reasoning":1000000}}'),
  ('u-custom', 's-custom', 1735689602000, 1735689602001,
   '{"role":"user","providerID":"fixture-custom","modelID":"fixture-model","cost":123.0}'),
  ('m-before', 's-history', 1735689599000, 1735689599001,
   '{"role":"assistant","providerID":"fixture-history","modelID":"fixture-model","cost":4.0,"tokens":{"input":1000000,"output":0,"cache":{"read":0,"write":0},"reasoning":0}}'),
  ('m-old', 's-history', 1751328000000, 1751328000001,
   '{"role":"assistant","providerID":"fixture-history","modelID":"fixture-model","cost":99.0,"tokens":{"input":1000000,"output":1000000,"cache":{"read":0,"write":0},"reasoning":0}}'),
  ('m-new', 's-history', 1772323200000, 1772323200001,
   '{"role":"assistant","providerID":"fixture-history","modelID":"fixture-model","cost":99.0,"tokens":{"input":1000000,"output":1000000,"cache":{"read":0,"write":0},"reasoning":0}}'),
  ('m-fallback', 's-fallback', 1767225601000, 1767225601001,
   '{"role":"assistant","providerID":"fixture-unknown","modelID":"fixture-model","cost":4.25,"tokens":{"input":1000000,"output":0,"cache":{"read":0,"write":0},"reasoning":0}}'),
  ('m-no-tokens', 's-invalid', 1767312001000, 1767312001001,
   '{"role":"assistant","providerID":"fixture-custom","modelID":"fixture-model","cost":3.5}'),
  ('m-no-date', 's-invalid', 'invalid-time', 1767312002001,
   '{"role":"assistant","providerID":"fixture-history","modelID":"fixture-model","cost":6.75,"tokens":{"input":1000000,"output":1000000,"cache":{"read":0,"write":0},"reasoning":0}}'),
  ('m-parent', 's-parent', 1767398401000, 1767398401001,
   '{"role":"assistant","providerID":"fixture-custom","modelID":"fixture-model","cost":99.0,"tokens":{"input":1000000,"output":0,"cache":{"read":0,"write":0},"reasoning":0}}'),
  ('m-child', 's-child', 1767484801000, 1767484801001,
   '{"role":"assistant","providerID":"fixture-custom","modelID":"fixture-model","cost":99.0,"tokens":{"input":0,"output":1000000,"cache":{"read":0,"write":0},"reasoning":0}}');
