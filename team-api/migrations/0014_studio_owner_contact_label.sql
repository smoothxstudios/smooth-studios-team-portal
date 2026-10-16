-- Rename the owner contact while retaining its number, notes, and every other card.
UPDATE studio_reference
SET data = json_set(data, '$.entries', json((
  SELECT json_group_array(json(CASE
    WHEN lower(trim(json_extract(value, '$.category'))) = 'contacts'
      AND lower(trim(json_extract(value, '$.label'))) = 'studio owner'
    THEN json_set(value, '$.label', 'Smooth')
    ELSE value END))
  FROM json_each(studio_reference.data, '$.entries')
))), revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
  SELECT 1 FROM json_each(studio_reference.data, '$.entries')
  WHERE lower(trim(json_extract(value, '$.category'))) = 'contacts'
    AND lower(trim(json_extract(value, '$.label'))) = 'studio owner'
);
