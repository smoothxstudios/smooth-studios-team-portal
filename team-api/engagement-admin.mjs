import { TEAM, localInstant, addLocalDays } from "../lib/team-schedule.mjs";
import { QUIZ_TIERS } from "../lib/team-engagement.mjs";

export async function resetEngagement({ db, input, env, day, now, fail }) {
  const active = JSON.parse(env.TEAM_TOKEN_HASHES);
  if (!TEAM.some(person => person.id !== "owner" && person.id === input.userId && active[person.id])) fail(400, "Choose an active employee.");
  if (input.day !== day) fail(409, "A new studio day has started. Refresh before resetting today's check-ins.");
  if (!['mood', 'question'].includes(input.kind)) fail(400, "Choose Temp Check or a quiz question.");
  if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId)) fail(400, "Refresh this reset and try again.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 240) fail(400, "Add a short reason (up to 240 characters).");
  if (input.kind === "mood" && (!Number.isSafeInteger(input.moodRevision) || input.moodRevision < 0)) fail(400, "Refresh this employee's Temp Check before resetting it.");
  if (input.kind === "question" && (!QUIZ_TIERS.some(t => t.id === input.tier) || typeof input.questionId !== "string" || input.questionId.length > 240 ||
    (input.attemptedAt !== null && (typeof input.attemptedAt !== "string" || !Number.isFinite(Date.parse(input.attemptedAt)))))) fail(400, "Choose one of today's questions.");
  const id = `reset:${input.requestId}`, requestData = JSON.stringify({ userId: input.userId, day, kind: input.kind, reason,
    ...(input.kind === "mood" ? { moodRevision: input.moodRevision } : { tier: input.tier, questionId: input.questionId, attemptedAt: input.attemptedAt }) });
  const previous = await db.prepare("SELECT request_data FROM team_engagement_resets WHERE id = ?").bind(id).first();
  if (previous) {
    if (previous.request_data !== requestData) fail(409, "This request was already used for a different reset. Refresh before trying again.");
    return;
  }
  const dayStart = Date.parse(localInstant(`${day}T00:00`)), dayEnd = Date.parse(localInstant(addLocalDays(`${day}T00:00`, 1)));
  if (input.kind === "mood") {
    await db.prepare(`INSERT OR IGNORE INTO team_engagement_resets
      (id, user_id, day, kind, reason, request_data, previous_data, day_start, day_end, created_at)
      SELECT ?, ?, ?, 'mood', ?, ?,
        (SELECT json_group_array(id) FROM team_mood_checkins WHERE user_id = ? AND reset_at IS NULL AND created_at >= ? AND created_at < ?), ?, ?, ?
      WHERE COALESCE((SELECT mood_revision FROM team_engagement_state WHERE user_id = ?), 0) = ?`)
      .bind(id, input.userId, day, reason, requestData, input.userId, dayStart, dayEnd, dayStart, dayEnd, now, input.userId, input.moodRevision).run();
  } else {
    // The new ID rejects submissions from a screen opened before the reset.
    const newId = `${input.questionId.split(":reset:")[0]}:reset:${input.requestId}`;
    await db.prepare(`WITH target AS (
      SELECT o.user_id, o.day, o.tier, o.data AS question, a.data AS attempt, a.points, a.created_at
      FROM team_quiz_offers o LEFT JOIN team_quiz_attempts a
        ON a.user_id = o.user_id AND a.day = o.day AND a.tier = o.tier AND a.reset_at IS NULL
      UNION ALL
      SELECT a.user_id, a.day, a.tier,
        json_set(json_extract(a.data, '$.question'), '$.correctOptionId', json_extract(a.data, '$.correctOptionId'),
          '$.explanation', json_extract(a.data, '$.explanation'), '$.source', json_extract(a.data, '$.source')),
        a.data, a.points, a.created_at FROM team_quiz_attempts a WHERE a.reset_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM team_quiz_offers o WHERE o.user_id = a.user_id AND o.day = a.day AND o.tier = a.tier)
      ) INSERT OR IGNORE INTO team_engagement_resets
      (id, user_id, day, kind, tier, reason, request_data, previous_data, new_question, points_removed, day_start, day_end, created_at)
      SELECT ?, t.user_id, t.day, 'question', t.tier, ?, ?,
        json_object('offer', json(t.question), 'attempt', json(t.attempt)), json_set(t.question, '$.id', ?),
        MIN(COALESCE(t.points, 0), COALESCE((SELECT points FROM team_reward_accounts WHERE user_id = t.user_id), 0)), ?, ?, ?
      FROM target t WHERE t.user_id = ? AND t.day = ? AND t.tier = ? AND json_extract(t.question, '$.id') = ?
        AND COALESCE(t.created_at, -1) = ?`)
      .bind(id, reason, requestData, newId, dayStart, dayEnd, now, input.userId, day, input.tier, input.questionId,
        input.attemptedAt === null ? -1 : Date.parse(input.attemptedAt)).run();
  }
  const saved = await db.prepare("SELECT request_data FROM team_engagement_resets WHERE id = ?").bind(id).first();
  if (!saved || saved.request_data !== requestData) fail(409, "This check-in or question changed. Refresh and review it before resetting.");
}
