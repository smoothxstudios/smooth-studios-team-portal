-- Active records keep their existing generation and identity. Only changed
-- records are staged; a separate token guards the atomic payroll transaction.
ALTER TABLE payroll_state ADD COLUMN mutation TEXT NOT NULL DEFAULT '';
CREATE TABLE sync_imports (
  kind TEXT NOT NULL CHECK(kind IN ('calendar', 'payroll')),
  generation TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(kind, generation)
);
