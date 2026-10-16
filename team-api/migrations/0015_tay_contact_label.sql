-- Shorten the contact label while preserving its number, notes, and other information.
UPDATE studio_reference
SET data = json_set(data, '$.entries', json((
  SELECT json_group_array(json(CASE
    WHEN lower(trim(json_extract(value, '$.category'))) = 'contacts'
      AND lower(trim(json_extract(value, '$.label'))) IN ('tay — secretary', 'tay – secretary', 'tay - secretary')
    THEN json_set(value, '$.label', 'Tay')
    ELSE value END))
  FROM json_each(studio_reference.data, '$.entries')
))), revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
  SELECT 1 FROM json_each(studio_reference.data, '$.entries')
  WHERE lower(trim(json_extract(value, '$.category'))) = 'contacts'
    AND lower(trim(json_extract(value, '$.label'))) IN ('tay — secretary', 'tay – secretary', 'tay - secretary')
);
