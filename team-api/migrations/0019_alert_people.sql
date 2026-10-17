ALTER TABLE team_inbox ADD COLUMN person_id TEXT;
DROP TRIGGER team_inbox_notification;
CREATE TRIGGER team_inbox_notification AFTER INSERT ON team_notification_events
WHEN json_valid(NEW.payload)
BEGIN
  INSERT OR IGNORE INTO team_inbox (id, user_id, kind, title, body, target, target_id, person_id, created_at)
  VALUES (NEW.id, NEW.user_id, NEW.kind,
    substr(COALESCE(json_extract(NEW.payload, '$.title'), 'Schedule update'), 1, 80),
    substr(COALESCE(json_extract(NEW.payload, '$.body'), ''), 1, 360),
    COALESCE(json_extract(NEW.payload, '$.target'), CASE NEW.kind WHEN 'creative' THEN 'creative' ELSE 'scheduling' END),
    json_extract(NEW.payload, '$.targetId'), json_extract(NEW.payload, '$.personId'), NEW.due_at);
END;
-- Attribute existing target-linked records without changing read status or sending pushes.
UPDATE team_inbox SET person_id = CASE
  WHEN target = 'scheduling' THEN (SELECT json_extract(data, '$.employeeId') FROM team_assignments WHERE id = target_id)
  WHEN target = 'creative' THEN (SELECT employee_id FROM team_creative_assignments WHERE id = target_id)
  ELSE NULL END;
