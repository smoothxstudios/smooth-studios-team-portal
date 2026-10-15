CREATE TABLE IF NOT EXISTS team_work_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS team_work_preferences_user ON team_work_preferences(user_id);
