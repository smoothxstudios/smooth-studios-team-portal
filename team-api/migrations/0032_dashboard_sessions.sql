CREATE TABLE dashboard_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL
);
CREATE INDEX dashboard_sessions_user ON dashboard_sessions(user_id, created_at);
CREATE INDEX dashboard_sessions_expiry ON dashboard_sessions(expires_at);
CREATE TABLE dashboard_snapshots (
  user_id TEXT PRIMARY KEY,
  envelope TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
