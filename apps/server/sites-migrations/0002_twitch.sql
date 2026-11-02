CREATE TABLE IF NOT EXISTS twitch_accounts (
  world_id TEXT PRIMARY KEY,
  owner_actor TEXT NOT NULL,
  broadcaster_id TEXT,
  broadcaster_login TEXT,
  token_cipher TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  validated_at INTEGER NOT NULL DEFAULT 0,
  refresh_lock INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS twitch_oauth_states (
  state_hash TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  owner_actor TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS twitch_webhook_messages (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  claimed_until INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS twitch_oauth_expiry ON twitch_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS twitch_webhook_expiry ON twitch_webhook_messages(received_at);
