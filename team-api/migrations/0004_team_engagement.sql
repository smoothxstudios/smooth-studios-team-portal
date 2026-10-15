CREATE TABLE IF NOT EXISTS team_engagement_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  next_mood_at INTEGER NOT NULL DEFAULT 0,
  last_mood_id TEXT,
  question_dismissed_day TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS team_mood_checkins (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  mood TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS team_mood_checkins_user_time ON team_mood_checkins(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_creative_attempts (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  points INTEGER NOT NULL CHECK (points IN (0, 10)),
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
