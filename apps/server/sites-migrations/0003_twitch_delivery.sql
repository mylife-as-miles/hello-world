CREATE TABLE IF NOT EXISTS twitch_subscriptions (
  world_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  callback TEXT NOT NULL,
  subscription_id TEXT,
  status TEXT NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, type)
);
ALTER TABLE twitch_accounts ADD COLUMN last_event_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE twitch_accounts ADD COLUMN last_event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS twitch_subscription_identity
  ON twitch_subscriptions(world_id, subscription_id);
ALTER TABLE twitch_webhook_messages ADD COLUMN claim_token TEXT NOT NULL DEFAULT '';
ALTER TABLE worlds ADD COLUMN last_ingress_token TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS world_ingress (
  world_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  applied_revision INTEGER NOT NULL CHECK(applied_revision >= 0),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, event_id)
);
