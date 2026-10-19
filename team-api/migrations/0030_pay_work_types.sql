CREATE TABLE owner_pay_work_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
  normalized_label TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
