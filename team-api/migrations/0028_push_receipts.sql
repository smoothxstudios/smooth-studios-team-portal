ALTER TABLE team_push_deliveries ADD COLUMN receipt_token TEXT;
ALTER TABLE team_push_deliveries ADD COLUMN result TEXT;
ALTER TABLE team_push_deliveries ADD COLUMN provider_status INTEGER;
ALTER TABLE team_push_deliveries ADD COLUMN received_at INTEGER;
ALTER TABLE team_push_deliveries ADD COLUMN opened_at INTEGER;
CREATE UNIQUE INDEX team_push_receipt_token ON team_push_deliveries(receipt_token) WHERE receipt_token IS NOT NULL;
ALTER TABLE team_inbox ADD COLUMN push_accepted_at INTEGER;
ALTER TABLE team_inbox ADD COLUMN push_received_at INTEGER;
ALTER TABLE team_inbox ADD COLUMN opened_at INTEGER;
