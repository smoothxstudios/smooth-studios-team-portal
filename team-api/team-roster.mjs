import { TEAM } from '../lib/team-schedule.mjs';

export async function readTeamRoster(db) {
  const { results } = await db.prepare('SELECT user_id, active, revision FROM team_roster').all();
  return TEAM.filter(person => person.id !== 'owner').map(person => {
    const row = results.find(row => row.user_id === person.id);
    return { id: person.id, active: row ? Boolean(row.active) : true, revision: row?.revision ?? 0 };
  });
}

export async function teamRosterRoute({ request, db, user, body, fail }) {
  if (request.method === 'GET') return { members: await readTeamRoster(db) };
  if (user !== 'owner') fail(403, 'Only Smooth can change team visibility.');
  if (request.method !== 'PUT') fail(405, 'Use the Active switch on the Team page.');
  const input = await body(request);
  if (!TEAM.some(person => person.id === input.id && person.id !== 'owner') || typeof input.active !== 'boolean' || !Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, 'Choose a team member and review their current status.');
  const now = new Date().toISOString();
  await db.prepare('INSERT OR IGNORE INTO team_roster (user_id, updated_at) VALUES (?, ?)').bind(input.id, now).run();
  const saved = await db.prepare('UPDATE team_roster SET active = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?')
    .bind(input.active ? 1 : 0, now, input.id, input.revision).run();
  if (!saved.meta.changes) fail(409, 'This person’s status changed on another device. Reload the team and try again.');
  return { id: input.id, active: input.active, revision: input.revision + 1 };
}
