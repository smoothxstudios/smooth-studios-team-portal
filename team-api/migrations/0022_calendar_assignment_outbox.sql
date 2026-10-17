-- Only new assignment mutations are queued. Existing offers are not replayed.
CREATE TABLE IF NOT EXISTS calendar_assignment_outbox (
  assignment_id TEXT PRIMARY KEY REFERENCES team_assignments(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_assignment_outbox_due
  ON calendar_assignment_outbox(status, next_attempt_at, lease_until);
