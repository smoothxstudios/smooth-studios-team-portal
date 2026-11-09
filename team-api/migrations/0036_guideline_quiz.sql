CREATE TABLE IF NOT EXISTS team_quiz_guidelines (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
