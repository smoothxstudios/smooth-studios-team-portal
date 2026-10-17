-- Keep deleted inbox entries as tombstones. The existing INSERT OR IGNORE
-- triggers cannot recreate them when a notification event is retried.
ALTER TABLE team_inbox ADD COLUMN deleted_at INTEGER;

DROP INDEX team_inbox_user_sequence;
DROP INDEX team_inbox_user_unread;
CREATE INDEX team_inbox_user_sequence ON team_inbox(user_id, deleted_at, sequence);
CREATE INDEX team_inbox_user_unread ON team_inbox(user_id, deleted_at, read_at, sequence);
