-- Only non-secret attempt IDs and the allowlisted basic-profile result.
-- Composio's key remains a Sites secret; the short-lived consent URL is encrypted.
CREATE TABLE IF NOT EXISTS composio_profile_proofs (
  world_id TEXT NOT NULL,
  owner_actor TEXT NOT NULL,
  status TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  attempt_json TEXT,
  link_cipher TEXT,
  result_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, owner_actor)
);
