CREATE TABLE IF NOT EXISTS rental_pay_policies (
  employee_id TEXT PRIMARY KEY,
  baseline TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  mutation TEXT
);
CREATE TABLE IF NOT EXISTS rental_pay_rate_changes (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES rental_pay_policies(employee_id),
  revision INTEGER NOT NULL,
  effective_at TEXT NOT NULL,
  compensation TEXT NOT NULL,
  UNIQUE(employee_id, revision)
);
