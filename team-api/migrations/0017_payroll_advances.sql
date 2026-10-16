CREATE TABLE payroll_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  generation TEXT NOT NULL DEFAULT '',
  synced_at TEXT
);
INSERT INTO payroll_state(id) VALUES (1);

CREATE TABLE payroll_rental_earnings (
  generation TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  rental_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  paid_cents INTEGER NOT NULL CHECK(paid_cents >= 0 AND paid_cents <= amount_cents),
  earned_at TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
  as_of TEXT NOT NULL,
  PRIMARY KEY(generation, employee_id, rental_id)
);

CREATE TABLE payroll_advances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  created_at TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(basis = 'unpaid-and-future')
);
CREATE INDEX payroll_advances_employee ON payroll_advances(employee_id, created_at);

CREATE TABLE payroll_advance_allocations (
  advance_id TEXT NOT NULL REFERENCES payroll_advances(id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('rental','creative')),
  source_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  cash_floor_cents INTEGER NOT NULL DEFAULT 0 CHECK(cash_floor_cents >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(advance_id, source_kind, source_id)
);
CREATE INDEX payroll_allocations_source ON payroll_advance_allocations(source_kind, source_id);

-- Creative payments remain explicit cash records. Rental paid-through markers
-- include previously settled advance amounts, which are handled by the floor
-- calculation in the allocator rather than counted as a second payment.
CREATE VIEW payroll_sources AS
  SELECT 'rental' AS kind, r.rental_id AS id, r.employee_id, r.amount_cents,
    r.paid_cents AS recorded_paid, r.earned_at
  FROM payroll_rental_earnings r JOIN payroll_state s ON s.generation = r.generation
  WHERE s.id = 1 AND r.eligible = 1
  UNION ALL
  SELECT 'creative', c.id, c.employee_id, CAST(json_extract(c.data, '$.amountCents') AS INTEGER),
    COALESCE((SELECT SUM(CAST(json_extract(p.value, '$.amountCents') AS INTEGER))
      FROM json_each(c.data, '$.payments') p), 0), json_extract(c.data, '$.approvedAt')
  FROM team_creative_assignments c WHERE json_extract(c.data, '$.status') = 'approved';
