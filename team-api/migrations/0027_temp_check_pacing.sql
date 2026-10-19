ALTER TABLE team_engagement_state ADD COLUMN next_mood_prompt_at INTEGER NOT NULL DEFAULT 0;
-- Shorten existing three-hour waits without replaying today's check-in.
UPDATE team_engagement_state SET next_mood_at = next_mood_at - 80 * 60000 WHERE next_mood_at > 0;
CREATE TRIGGER team_mood_prompt_reset AFTER INSERT ON team_engagement_resets
WHEN NEW.kind = 'mood'
BEGIN
  UPDATE team_engagement_state SET next_mood_prompt_at = 0 WHERE user_id = NEW.user_id;
END;
