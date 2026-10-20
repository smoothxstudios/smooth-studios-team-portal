-- Only a digest of the read-only subscription credential is stored. The nonce
-- lets the signed-in account recover the same link without retaining it locally.
CREATE TABLE apple_calendar_subscriptions (
  user_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  credential_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
