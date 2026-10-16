-- Each event has its own queue entry, so responses to different bookings
-- cannot overwrite each other. Retain the legacy queue for in-flight alerts
-- and for the old Worker during the migration/deployment handover.
CREATE TABLE team_notification_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'schedule',
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL
);
CREATE INDEX team_notification_events_due ON team_notification_events(due_at);
