ALTER TABLE team_roster ADD COLUMN rental_deduction_start TEXT;

-- A changed cutoff invalidates previews before another payroll receipt can save.
CREATE TRIGGER payroll_revision_team_rental_start_insert AFTER INSERT ON team_roster
WHEN NEW.rental_deduction_start IS NOT NULL
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_rental_start_update AFTER UPDATE OF rental_deduction_start ON team_roster
WHEN OLD.rental_deduction_start IS NOT NEW.rental_deduction_start
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER payroll_revision_team_rental_start_delete AFTER DELETE ON team_roster
WHEN OLD.rental_deduction_start IS NOT NULL
BEGIN UPDATE payroll_account_revision SET revision=revision+1 WHERE id=1; END;
