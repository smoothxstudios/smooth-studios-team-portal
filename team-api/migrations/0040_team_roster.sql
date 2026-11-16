CREATE TABLE IF NOT EXISTS team_roster (
  user_id TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO team_roster (user_id, active, revision, updated_at) VALUES
  ('akiva', 0, 1, '2026-11-16T00:00:00Z'),
  ('carlos', 0, 1, '2026-11-16T00:00:00Z'),
  ('armani', 0, 1, '2026-11-16T00:00:00Z');
