import { TEAM, studioLocal, localInstant, addLocalDays } from "../lib/team-schedule.mjs";
import { offerQuestion } from "./engagement.mjs";
import { sendAlert } from "./push.mjs";

export async function sendQuizReminders(env, send = fetch, now = Date.now()) {
  if (!env.TEAM_TOKEN_HASHES) return;
  const db = env.DB, day = studioLocal(now).slice(0, 10), active = JSON.parse(env.TEAM_TOKEN_HASHES);
  // The day starts when the employee visits their dashboard. Do not wake
  // everyone at midnight or start a new day's quiz for absent employees.
  const people = (await db.prepare(`SELECT user_id FROM team_quiz_offers WHERE day = ?
    UNION SELECT user_id FROM team_quiz_attempts WHERE day = ? AND reset_at IS NULL`)
    .bind(day, day).all()).results.filter(row => row.user_id !== "owner" && active[row.user_id] && TEAM.some(p => p.id === row.user_id));
  const midnight = Date.parse(localInstant(addLocalDays(`${day}T00:00`, 1)));
  // Allocate in sequence using the same atomic, individual-question allocator
  // as the dashboard. A reminder never exposes the question or its answer.
  const alerts = [];
  for (const { user_id: user } of people) {
    const offer = await offerQuestion(db, user, day, now);
    if (!offer || offer.dismissed_at !== null) continue;
    const questionId = JSON.parse(offer.data).id;
    await db.prepare(`INSERT OR IGNORE INTO team_quiz_reminders (id, user_id, day, question_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), user, day, questionId, now, midnight).run();
    const reminder = await db.prepare("SELECT * FROM team_quiz_reminders WHERE user_id = ? AND day = ? AND question_id = ?")
      .bind(user, day, questionId).first();
    // Re-check after allocation: an open dashboard may already have displayed
    // or answered this offer, or Smooth may have reset it in the meantime.
    const stillReady = await db.prepare(`SELECT 1 AS ready FROM team_quiz_offers o
      WHERE o.user_id = ? AND o.day = ? AND json_extract(o.data, '$.id') = ? AND o.dismissed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM team_quiz_attempts a WHERE a.user_id = o.user_id AND a.day = o.day AND a.tier = o.tier AND a.reset_at IS NULL)`)
      .bind(user, day, questionId).first();
    if (stillReady && reminder.expires_at > now) alerts.push({ ...reminder, kind: "quiz", payload: JSON.stringify({ title: "Quiz Time", body: "Your next creative question is ready. Answer it to earn points toward a SmoothStar." }) });
  }
  if (env.VAPID_JWK) await Promise.all(alerts.map(alert => sendAlert(env, alert, send, now)));
  // Keep short-lived delivery receipts for retries/deduplication, not a
  // permanent notification history. team_inbox keeps the separate history.
  // Quiz answers and rewards are untouched.
  await db.batch([
    db.prepare("DELETE FROM team_quiz_reminders WHERE expires_at < ?").bind(now - 7 * 86400_000),
    db.prepare("DELETE FROM team_push_deliveries WHERE created_at < ?").bind(now - 7 * 86400_000),
  ]);
}
