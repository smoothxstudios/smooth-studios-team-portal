-- Keep the original ledger intact; each historical 10-point question occupies
-- the Medium slot. Scores, answers, timestamps, and explanations are preserved.
CREATE TABLE IF NOT EXISTS team_quiz_attempts (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('easy', 'medium', 'hard')),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  points INTEGER NOT NULL CHECK (
    (correct = 0 AND points = 0) OR
    (correct = 1 AND ((tier = 'easy' AND points = 5) OR
      (tier = 'medium' AND points = 10) OR (tier = 'hard' AND points = 15)))
  ),
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, day, tier)
);

INSERT OR IGNORE INTO team_quiz_attempts (user_id, day, tier, correct, points, created_at, data)
SELECT user_id, day, 'medium', correct, points, created_at,
  json_set(data, '$.tier', 'medium', '$.question.tier', 'medium', '$.question.points', 10)
FROM team_creative_attempts;
