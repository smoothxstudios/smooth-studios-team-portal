-- Owner Home preferences have their own revision and never alter the schedule.
CREATE TABLE owner_dashboard_layout (
  id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  order_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT owner_dashboard_layout_single_owner CHECK (id = 1),
  CONSTRAINT owner_dashboard_layout_revision CHECK (revision >= 0)
);
INSERT INTO owner_dashboard_layout(id, revision, order_json, updated_at)
VALUES (1, 0, '["upcoming","attention","finances","hours","creative","reports"]', 0);
