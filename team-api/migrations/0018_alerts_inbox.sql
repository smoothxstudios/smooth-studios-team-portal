-- Keep account-specific history independently of the short-lived push queue.
-- Triggers share the originating transaction: failed assignment writes never
-- create an alert, and successful delivery cannot erase inbox history.
CREATE TABLE team_inbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT NOT NULL,
  target_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  read_at INTEGER
);
CREATE INDEX team_inbox_user_sequence ON team_inbox(user_id, sequence);
CREATE INDEX team_inbox_user_unread ON team_inbox(user_id, read_at, sequence);

CREATE TRIGGER team_inbox_notification AFTER INSERT ON team_notification_events
WHEN json_valid(NEW.payload)
BEGIN
  INSERT OR IGNORE INTO team_inbox (id, user_id, kind, title, body, target, target_id, created_at)
  VALUES (NEW.id, NEW.user_id, NEW.kind,
    substr(COALESCE(json_extract(NEW.payload, '$.title'), 'Schedule update'), 1, 80),
    substr(COALESCE(json_extract(NEW.payload, '$.body'), 'Open your schedule for details.'), 1, 360),
    COALESCE(json_extract(NEW.payload, '$.target'), CASE NEW.kind WHEN 'creative' THEN 'creative' ELSE 'scheduling' END),
    json_extract(NEW.payload, '$.targetId'), NEW.due_at);
END;

CREATE TRIGGER team_inbox_quiz AFTER INSERT ON team_quiz_reminders
BEGIN
  INSERT OR IGNORE INTO team_inbox (id, user_id, kind, title, body, target, created_at, expires_at)
  VALUES (NEW.id, NEW.user_id, 'quiz', 'Quiz Time',
    'Your next creative question is ready. Answer it to earn points toward a SmoothStar.',
    'quiz', NEW.created_at, NEW.expires_at);
END;

-- Only queued events still exist to backfill. Previously delivered pushes
-- cannot be reconstructed. Do not replay notifications during migration.
INSERT OR IGNORE INTO team_inbox (id, user_id, kind, title, body, target, target_id, created_at)
SELECT id, user_id, kind,
  substr(COALESCE(json_extract(payload, '$.title'), 'Schedule update'), 1, 80),
  substr(COALESCE(json_extract(payload, '$.body'), 'Open your schedule for details.'), 1, 360),
  COALESCE(json_extract(payload, '$.target'), CASE kind WHEN 'creative' THEN 'creative' ELSE 'scheduling' END),
  json_extract(payload, '$.targetId'), due_at
FROM team_notification_events WHERE json_valid(payload);
