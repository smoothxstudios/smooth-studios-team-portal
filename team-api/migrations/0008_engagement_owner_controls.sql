-- Preserve reset records and original answer snapshots; only active records
-- contribute to the employee's current results.
ALTER TABLE team_mood_checkins ADD COLUMN reset_at INTEGER;
ALTER TABLE team_engagement_state ADD COLUMN mood_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_quiz_attempts ADD COLUMN reset_at INTEGER;
ALTER TABLE team_quiz_offers ADD COLUMN reset_ready INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_reward_accounts ADD COLUMN removed_stars INTEGER NOT NULL DEFAULT 0 CHECK (removed_stars >= 0);

-- SQLite requires recreating this small ledger to extend its CHECK constraint.
-- Copy every existing entry verbatim before replacing the table.
DROP TRIGGER team_manual_reward_insert;
ALTER TABLE team_reward_changes RENAME TO team_reward_changes_previous;
CREATE TABLE team_reward_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('points', 'star')),
  amount INTEGER NOT NULL CHECK (
    (kind = 'points' AND amount != 0 AND amount BETWEEN -10000 AND 10000) OR
    (kind = 'star' AND (amount = 1 OR amount BETWEEN -10000 AND -1))
  ),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor = 'owner'),
  created_at INTEGER NOT NULL
);
INSERT INTO team_reward_changes SELECT * FROM team_reward_changes_previous;
DROP TABLE team_reward_changes_previous;
CREATE INDEX team_reward_changes_user_time ON team_reward_changes (user_id, created_at DESC);
CREATE TRIGGER team_manual_reward_insert AFTER INSERT ON team_reward_changes
BEGIN
  INSERT INTO team_reward_accounts (user_id) SELECT NEW.user_id
    WHERE NOT EXISTS (SELECT 1 FROM team_reward_accounts WHERE user_id = NEW.user_id);
  UPDATE team_reward_accounts SET
    points = points + CASE WHEN NEW.kind = 'points' THEN NEW.amount ELSE 0 END,
    peak_points = MAX(peak_points, points + CASE WHEN NEW.kind = 'points' THEN NEW.amount ELSE 0 END),
    awarded_stars = awarded_stars + CASE WHEN NEW.kind = 'star' AND NEW.amount > 0 THEN NEW.amount ELSE 0 END,
    removed_stars = removed_stars + CASE WHEN NEW.kind = 'star' AND NEW.amount < 0 THEN -NEW.amount ELSE 0 END
    WHERE user_id = NEW.user_id;
END;

CREATE TABLE team_engagement_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mood', 'question')),
  tier TEXT CHECK (tier IN ('easy', 'medium', 'hard')),
  reason TEXT NOT NULL,
  request_data TEXT NOT NULL,
  previous_data TEXT NOT NULL,
  new_question TEXT,
  points_removed INTEGER NOT NULL DEFAULT 0 CHECK (points_removed >= 0),
  day_start INTEGER NOT NULL,
  day_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX team_engagement_resets_user_time ON team_engagement_resets (user_id, created_at DESC);
CREATE TRIGGER team_engagement_reset_insert AFTER INSERT ON team_engagement_resets
BEGIN
  INSERT OR IGNORE INTO team_engagement_state (user_id) SELECT NEW.user_id WHERE NEW.kind = 'mood';
  UPDATE team_engagement_state SET next_mood_at = NEW.created_at, last_mood_id = NULL,
    mood_revision = mood_revision + 1 WHERE user_id = NEW.user_id AND NEW.kind = 'mood';
  UPDATE team_mood_checkins SET reset_at = NEW.created_at
    WHERE user_id = NEW.user_id AND reset_at IS NULL AND NEW.kind = 'mood'
      AND created_at >= NEW.day_start AND created_at < NEW.day_end;

  INSERT INTO team_reward_changes (id, user_id, kind, amount, reason, actor, created_at)
    SELECT NEW.id, NEW.user_id, 'points', -NEW.points_removed, 'Quiz reset: ' || NEW.reason, 'owner', NEW.created_at
    WHERE NEW.kind = 'question' AND NEW.points_removed > 0;
  UPDATE team_quiz_attempts SET reset_at = NEW.created_at
    WHERE user_id = NEW.user_id AND day = NEW.day AND tier = NEW.tier AND reset_at IS NULL AND NEW.kind = 'question';
  -- Earlier quiz versions could have an answer without an offer. Reopen it in
  -- a free slot while retaining its original options and grading snapshot.
  INSERT OR IGNORE INTO team_quiz_offers (user_id, day, slot, tier, offered_at, data)
    SELECT NEW.user_id, NEW.day, slots.slot, NEW.tier, NEW.created_at, NEW.new_question
    FROM (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3) slots
    WHERE NEW.kind = 'question'
      AND NOT EXISTS (SELECT 1 FROM team_quiz_offers o WHERE o.user_id = NEW.user_id AND o.day = NEW.day AND o.tier = NEW.tier)
      AND NOT EXISTS (SELECT 1 FROM team_quiz_offers o WHERE o.user_id = NEW.user_id AND o.day = NEW.day AND o.slot = slots.slot)
    ORDER BY slots.slot LIMIT 1;
  UPDATE team_quiz_offers SET reset_ready = CASE WHEN tier = NEW.tier THEN 1 ELSE 0 END
    WHERE user_id = NEW.user_id AND day = NEW.day AND NEW.kind = 'question';
  UPDATE team_quiz_offers SET data = NEW.new_question, dismissed_at = NULL
    WHERE user_id = NEW.user_id AND day = NEW.day AND tier = NEW.tier AND NEW.kind = 'question';
END;

DROP TRIGGER team_quiz_reward_insert;
CREATE TRIGGER team_quiz_reward_insert AFTER INSERT ON team_quiz_attempts WHEN NEW.reset_at IS NULL
BEGIN
  INSERT INTO team_reward_accounts (user_id) SELECT NEW.user_id
    WHERE NOT EXISTS (SELECT 1 FROM team_reward_accounts WHERE user_id = NEW.user_id);
  UPDATE team_reward_accounts SET points = points + NEW.points,
    peak_points = MAX(peak_points, points + NEW.points) WHERE user_id = NEW.user_id;
  UPDATE team_quiz_offers SET reset_ready = 0 WHERE user_id = NEW.user_id AND day = NEW.day;
END;
CREATE TRIGGER team_quiz_reward_retry AFTER UPDATE ON team_quiz_attempts
WHEN OLD.reset_at IS NOT NULL AND NEW.reset_at IS NULL
BEGIN
  INSERT INTO team_reward_accounts (user_id) SELECT NEW.user_id
    WHERE NOT EXISTS (SELECT 1 FROM team_reward_accounts WHERE user_id = NEW.user_id);
  UPDATE team_reward_accounts SET points = points + NEW.points,
    peak_points = MAX(peak_points, points + NEW.points) WHERE user_id = NEW.user_id;
  UPDATE team_quiz_offers SET reset_ready = 0 WHERE user_id = NEW.user_id AND day = NEW.day;
END;
