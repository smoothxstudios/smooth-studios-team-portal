-- Daily question reservations should not scan the team's full answer history.
CREATE INDEX IF NOT EXISTS team_quiz_offers_day ON team_quiz_offers (day);
CREATE INDEX IF NOT EXISTS team_quiz_attempts_day ON team_quiz_attempts (day);
