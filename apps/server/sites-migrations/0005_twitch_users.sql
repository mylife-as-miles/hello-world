-- Public Twitch login uses Composio's managed app; provider tokens stay with Composio.
CREATE TABLE IF NOT EXISTS twitch_login_config (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  auth_config_id TEXT,
  claim_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS twitch_login_attempts (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  auth_config_id TEXT NOT NULL,
  connected_account_id TEXT,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS twitch_users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  composio_user_id TEXT NOT NULL,
  composio_account_id TEXT NOT NULL,
  auth_config_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS twitch_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  twitch_user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS twitch_auth_sessions_user ON twitch_auth_sessions(twitch_user_id);
CREATE TABLE IF NOT EXISTS world_owners (
  world_id TEXT PRIMARY KEY,
  twitch_user_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS twitch_auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);
