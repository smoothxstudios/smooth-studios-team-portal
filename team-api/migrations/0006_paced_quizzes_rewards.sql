-- Server-issued question snapshots keep the same question across devices and deployments.
CREATE TABLE IF NOT EXISTS team_quiz_offers (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  tier TEXT NOT NULL CHECK (tier IN ('easy', 'medium', 'hard')),
  offered_at INTEGER NOT NULL,
  dismissed_at INTEGER,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, day, slot),
  UNIQUE (user_id, day, tier)
);

CREATE TABLE IF NOT EXISTS team_reward_accounts (
  user_id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  peak_points INTEGER NOT NULL DEFAULT 0 CHECK (peak_points >= points),
  awarded_stars INTEGER NOT NULL DEFAULT 0 CHECK (awarded_stars >= 0)
);
-- Import previous quiz totals once, without changing any original answers.
INSERT OR IGNORE INTO team_reward_accounts (user_id, points, peak_points)
SELECT user_id, SUM(points), SUM(points) FROM team_quiz_attempts GROUP BY user_id;

CREATE TABLE IF NOT EXISTS team_reward_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('points', 'star')),
  amount INTEGER NOT NULL CHECK ((kind = 'points' AND amount != 0 AND amount BETWEEN -10000 AND 10000) OR (kind = 'star' AND amount = 1)),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor = 'owner'),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS team_reward_changes_user_time ON team_reward_changes (user_id, created_at DESC);

-- A unique answer/adjustment and its balance update commit together. Retrying an
-- INSERT OR IGNORE cannot award again. Earned stickers survive point deductions;
-- peak_points prevents removing and re-adding points from earning extra stickers.
CREATE TRIGGER IF NOT EXISTS team_quiz_reward_insert AFTER INSERT ON team_quiz_attempts
BEGIN
  INSERT OR IGNORE INTO team_reward_accounts (user_id) VALUES (NEW.user_id);
  UPDATE team_reward_accounts SET points = points + NEW.points,
    peak_points = MAX(peak_points, points + NEW.points) WHERE user_id = NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS team_manual_reward_insert AFTER INSERT ON team_reward_changes
BEGIN
  INSERT OR IGNORE INTO team_reward_accounts (user_id) VALUES (NEW.user_id);
  UPDATE team_reward_accounts SET
    points = points + CASE WHEN NEW.kind = 'points' THEN NEW.amount ELSE 0 END,
    peak_points = MAX(peak_points, points + CASE WHEN NEW.kind = 'points' THEN NEW.amount ELSE 0 END),
    awarded_stars = awarded_stars + CASE WHEN NEW.kind = 'star' THEN NEW.amount ELSE 0 END
    WHERE user_id = NEW.user_id;
END;
