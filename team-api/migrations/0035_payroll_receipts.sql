CREATE TABLE payroll_receipts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  mutation TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX payroll_receipts_employee ON payroll_receipts(employee_id, created_at);
CREATE TABLE payroll_rental_settlements (
  employee_id TEXT NOT NULL,
  rental_id TEXT NOT NULL,
  settled_cents INTEGER NOT NULL CHECK(settled_cents >= 0),
  deduction_cents INTEGER NOT NULL DEFAULT 0 CHECK(deduction_cents >= 0),
  PRIMARY KEY(employee_id, rental_id)
);
CREATE TABLE payroll_rental_deductions (
  employee_id TEXT NOT NULL,
  rental_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  PRIMARY KEY(employee_id, rental_id)
);
CREATE TABLE payroll_account_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO payroll_account_revision(id) VALUES (1);

DROP VIEW payroll_sources;
CREATE VIEW payroll_sources AS
  SELECT 'rental' AS kind, r.rental_id AS id, r.employee_id, r.amount_cents,
    MAX(r.paid_cents, COALESCE(p.settled_cents,0)) AS recorded_paid, r.earned_at
  FROM payroll_rental_earnings r JOIN payroll_state s ON s.generation=r.generation
  LEFT JOIN payroll_rental_settlements p ON p.employee_id=r.employee_id AND p.rental_id=r.rental_id
  WHERE s.id=1 AND r.eligible=1
  UNION ALL
  SELECT 'creative', c.id, c.employee_id, CAST(json_extract(c.data,'$.amountCents') AS INTEGER),
    COALESCE((SELECT SUM(CAST(json_extract(p.value,'$.amountCents') AS INTEGER)) FROM json_each(c.data,'$.payments') p),0),
    COALESCE(json_extract(c.data,'$.earnedAt'),json_extract(c.data,'$.approvedAt'))
  FROM team_creative_assignments c WHERE json_extract(c.data,'$.status')='approved';

CREATE TRIGGER payroll_revision_payroll_rental_earnings_insert AFTER INSERT ON payroll_rental_earnings
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_earnings_update AFTER UPDATE ON payroll_rental_earnings
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_earnings_delete AFTER DELETE ON payroll_rental_earnings
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_state_insert AFTER INSERT ON payroll_state
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_state_update AFTER UPDATE ON payroll_state WHEN OLD.generation IS NOT NEW.generation
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_state_delete AFTER DELETE ON payroll_state
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_advance_allocations_insert AFTER INSERT ON payroll_advance_allocations
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_advance_allocations_update AFTER UPDATE ON payroll_advance_allocations
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_advance_allocations_delete AFTER DELETE ON payroll_advance_allocations
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_creative_assignments_insert AFTER INSERT ON team_creative_assignments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_creative_assignments_update AFTER UPDATE ON team_creative_assignments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_creative_assignments_delete AFTER DELETE ON team_creative_assignments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_appointments_insert AFTER INSERT ON team_appointments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_appointments_update AFTER UPDATE ON team_appointments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_appointments_delete AFTER DELETE ON team_appointments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_state_insert AFTER INSERT ON team_state
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_state_update AFTER UPDATE ON team_state WHEN OLD.generation IS NOT NEW.generation
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_state_delete AFTER DELETE ON team_state
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_assignments_insert AFTER INSERT ON team_assignments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_assignments_update AFTER UPDATE ON team_assignments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_assignments_delete AFTER DELETE ON team_assignments
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_settlements_insert AFTER INSERT ON payroll_rental_settlements
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_settlements_update AFTER UPDATE ON payroll_rental_settlements
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_settlements_delete AFTER DELETE ON payroll_rental_settlements
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_deductions_insert AFTER INSERT ON payroll_rental_deductions
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_deductions_update AFTER UPDATE ON payroll_rental_deductions
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_payroll_rental_deductions_delete AFTER DELETE ON payroll_rental_deductions
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;
