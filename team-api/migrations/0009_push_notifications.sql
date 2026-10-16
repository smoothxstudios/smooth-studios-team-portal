ALTER TABLE team_devices ADD COLUMN p256dh TEXT;
ALTER TABLE team_devices ADD COLUMN auth TEXT;
ALTER TABLE team_alerts ADD COLUMN kind TEXT NOT NULL DEFAULT 'schedule';

CREATE TABLE team_quiz_reminders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX team_quiz_reminders_question ON team_quiz_reminders(user_id, day, question_id);
CREATE INDEX team_quiz_reminders_day ON team_quiz_reminders(day);

CREATE TABLE team_push_deliveries (
  alert_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(alert_id, device_id)
);
CREATE INDEX team_push_deliveries_created ON team_push_deliveries(created_at);
