CREATE TABLE IF NOT EXISTS team_profiles (
  user_id TEXT PRIMARY KEY,
  icon_mode TEXT NOT NULL DEFAULT 'initial' CHECK(icon_mode IN ('initial', 'photo')),
  photo_data_url TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
