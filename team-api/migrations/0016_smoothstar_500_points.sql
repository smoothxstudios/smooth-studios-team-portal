-- Keep stars earned under the original 100-point goal, including stars later
-- removed by Smooth. Carry remaining progress toward each new 500-point goal.
ALTER TABLE team_reward_accounts ADD COLUMN baseline_stars INTEGER NOT NULL DEFAULT 0 CHECK (baseline_stars >= 0);
ALTER TABLE team_reward_accounts ADD COLUMN baseline_points INTEGER NOT NULL DEFAULT 0 CHECK (baseline_points >= 0);
UPDATE team_reward_accounts
SET baseline_stars = CAST(peak_points / 100 AS INTEGER),
    baseline_points = CAST(peak_points / 100 AS INTEGER) * 100;
