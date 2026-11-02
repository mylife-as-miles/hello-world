CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  pending_json TEXT NOT NULL DEFAULT '[]',
  limits_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_sessions (
  world_id TEXT NOT NULL,
  id TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  request_window INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (world_id, id)
);
CREATE INDEX IF NOT EXISTS world_sessions_presence ON world_sessions(world_id, last_seen);
