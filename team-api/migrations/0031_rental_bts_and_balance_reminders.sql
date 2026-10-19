-- Keep owner's existing checklist entries and add three studio rental handoff steps.
UPDATE studio_reference SET data = json_insert(data, '$.checklist[#]',
  json_object('id','bts-video-record','phase','During rental','label','Record a BTS video')),
  revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE revision > 0 AND NOT EXISTS (
  SELECT 1 FROM json_each(data,'$.checklist')
  WHERE json_extract(value,'$.id') = 'bts-video-record'
  OR lower(json_extract(value,'$.label')) = 'record a bts video'
);

UPDATE studio_reference SET data = json_insert(data, '$.checklist[#]',
  json_object('id','bts-video-vault','phase','After rental','label','Post BTS video to Content Vault')),
  revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE revision > 0 AND NOT EXISTS (
  SELECT 1 FROM json_each(data,'$.checklist')
  WHERE json_extract(value,'$.id') = 'bts-video-vault'
  OR lower(json_extract(value,'$.label')) LIKE '%bts%content vault%'
);

UPDATE studio_reference SET data = json_insert(data, '$.checklist[#]',
  json_object('id','trigger-return','phase','Closing','label','Ask for the trigger back')),
  revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE revision > 0 AND NOT EXISTS (
  SELECT 1 FROM json_each(data,'$.checklist')
  WHERE json_extract(value,'$.id') = 'trigger-return'
  OR lower(json_extract(value,'$.label')) LIKE '%trigger back%'
);

-- One receipt per rental/end/person. New receipts atomically queue inbox + push.
CREATE TABLE rental_balance_reminders (
  id TEXT PRIMARY KEY NOT NULL,
  appointment_id TEXT NOT NULL,
  end_time TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  UNIQUE(appointment_id,end_time,user_id)
);
CREATE INDEX rental_balance_reminders_due ON rental_balance_reminders(ends_at);

CREATE TRIGGER rental_balance_reminders_queue AFTER INSERT ON rental_balance_reminders
BEGIN
  INSERT INTO team_notification_events(id,user_id,kind,payload,due_at)
  VALUES (NEW.id,NEW.user_id,'notice',NEW.payload,NEW.due_at);
  UPDATE team_inbox SET expires_at = NEW.ends_at WHERE id = NEW.id;
END;
