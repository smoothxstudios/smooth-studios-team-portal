-- Keep owner-sent notice receipts after delivery and inbox deletion, so a
-- retried client request cannot recreate either a push or a dismissed alert.
CREATE TABLE manual_notices (
  id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  recipient_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT NOT NULL,
  target_id TEXT,
  assignment_id TEXT,
  operation_token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX manual_notices_created ON manual_notices(created_at);
CREATE INDEX manual_notices_assignment ON manual_notices(assignment_id, created_at);
