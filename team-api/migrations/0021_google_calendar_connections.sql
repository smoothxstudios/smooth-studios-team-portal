-- OAuth secrets and tokens are encrypted by the Worker before storage.
CREATE TABLE calendar_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  data TEXT NOT NULL,
  version TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE calendar_connections (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  config_version TEXT NOT NULL,
  data TEXT NOT NULL,
  browser_hash TEXT,
  expires_at INTEGER NOT NULL,
  started_at INTEGER,
  used_at INTEGER
);
CREATE INDEX calendar_oauth_states_expiry ON calendar_oauth_states(expires_at);
CREATE INDEX calendar_oauth_states_user ON calendar_oauth_states(user_id);

-- Only authenticated deployment sync may write the private roster and calendar.
CREATE TABLE calendar_sync_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  data TEXT NOT NULL
);
