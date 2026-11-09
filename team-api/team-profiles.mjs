import { TEAM } from "../lib/team-schedule.mjs";

export function validProfilePhoto(value) {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 100_000) return false;
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4) return false;
  let bytes;
  try { bytes = atob(match[2]); } catch { return false; }
  return match[1] === "jpeg" ? bytes.startsWith("\xff\xd8\xff")
    : match[1] === "png" ? bytes.startsWith("\x89PNG\r\n\x1a\n")
    : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
}

export async function teamProfilesRoute({ request, db, user, body, fail }) {
  if (!TEAM.some(person => person.id === user)) fail(403, "Sign in to view team icons.");
  if (request.method === "GET") {
    const rows = await db.prepare("SELECT user_id, icon_mode, photo_data_url, revision FROM team_profiles").all();
    return { profiles: rows.results.map(row => ({ userId: row.user_id, mode: row.icon_mode, photo: row.icon_mode === "photo" || row.user_id === user ? row.photo_data_url : null, revision: row.revision })) };
  }
  if (request.method !== "PUT") fail(405, "This profile action is not available.");
  const input = await body(request);
  if (input.userId !== undefined && input.userId !== user) fail(403, "You can only change your own icon.");
  if (!["initial", "photo"].includes(input.mode) || !validProfilePhoto(input.photo) || (input.mode === "photo" && !input.photo)) fail(400, "Choose an initial or a JPG, PNG, or WebP photo.");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, "Reload your profile before saving.");
  await db.prepare("INSERT OR IGNORE INTO team_profiles (user_id, updated_at) VALUES (?, ?)").bind(user, Date.now()).run();
  const result = await db.prepare("UPDATE team_profiles SET icon_mode = ?, photo_data_url = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?")
    .bind(input.mode, input.photo, Date.now(), user, input.revision).run();
  if (!result.meta.changes) fail(409, "Your icon changed on another device. Reload your profile before saving.");
  return { userId: user, mode: input.mode, photo: input.photo, revision: input.revision + 1 };
}
