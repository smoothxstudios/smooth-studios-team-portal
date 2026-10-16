CREATE TABLE team_creative_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  employee_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  mutation TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX team_creative_employee_idx ON team_creative_assignments (employee_id);
