-- Retain the requested reference categories and the complete reusable checklist.
-- No private values are embedded in the migration. Empty, unimported rows stay at revision zero.
UPDATE studio_reference
SET data = json_set(data, '$.entries', json((
  SELECT COALESCE(json_group_array(json_set(value, '$.category', CASE
    WHEN lower(trim(json_extract(value, '$.category'))) = 'contacts' THEN 'Contacts'
    WHEN lower(trim(json_extract(value, '$.category'))) IN ('wi-fi', 'wifi') THEN 'Wi-Fi'
    WHEN lower(trim(json_extract(value, '$.category'))) = 'access & wi-fi'
      AND (lower(json_extract(value, '$.label')) LIKE '%wi-fi%'
        OR lower(json_extract(value, '$.label')) LIKE '%wifi%'
        OR lower(json_extract(value, '$.label')) LIKE '%wi fi%'
        OR lower(json_extract(value, '$.label')) LIKE '%network%') THEN 'Wi-Fi'
    ELSE 'Access' END)), '[]')
  FROM json_each(studio_reference.data, '$.entries')
  WHERE lower(trim(json_extract(value, '$.category'))) IN ('contacts', 'access', 'wi-fi', 'wifi', 'access & wi-fi')
))), revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE revision > 0;
