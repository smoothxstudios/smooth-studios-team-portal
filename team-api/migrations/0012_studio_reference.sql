CREATE TABLE studio_reference (
  id INTEGER PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{"entries":[],"checklist":[]}',
  imported_id TEXT,
  updated_at TEXT
);
INSERT INTO studio_reference (id) VALUES (1);
CREATE TABLE rental_checklists (
  id TEXT PRIMARY KEY NOT NULL,
  appointment_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL
);
CREATE INDEX rental_checklist_appointment_idx ON rental_checklists (appointment_id);
