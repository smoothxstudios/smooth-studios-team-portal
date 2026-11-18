import { TEAM } from '../lib/team-schedule.mjs';
import { validRentalDeductionStart } from '../lib/team-rental-policy.mjs';

export async function readTeamRoster(db) {
  const { results } = await db.prepare('SELECT user_id, active, revision, rental_deduction_start FROM team_roster').all();
  return TEAM.filter(person => person.id !== 'owner').map(person => {
    const row = results.find(row => row.user_id === person.id);
    return { id: person.id, active: row ? Boolean(row.active) : true, revision: row?.revision ?? 0,
      rentalDeductionStart: row?.rental_deduction_start ?? null };
  });
}

export async function teamRosterRoute({ request, db, user, body, fail }) {
  if (request.method === 'GET') {
    const members = await readTeamRoster(db);
    return { members: user === 'owner' ? members : members.map(({ rentalDeductionStart, ...member }) => member) };
  }
  if (user !== 'owner') fail(403, 'Only Smooth can change team settings.');
  if (request.method !== 'PUT') fail(405, 'Use the controls on the Team page.');
  const input = await body(request);
  const changeActive = Object.hasOwn(input, 'active'), changeStart = Object.hasOwn(input, 'rentalDeductionStart');
  if (!TEAM.some(person => person.id === input.id && person.id !== 'owner') || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      (!changeActive && !changeStart) || (changeActive && typeof input.active !== 'boolean')) fail(400, 'Choose a team member and review their current settings.');
  if (changeStart && input.rentalDeductionStart !== null && !validRentalDeductionStart(input.rentalDeductionStart)) fail(400, 'Enter a valid team start date or leave it blank.');
  const now = new Date().toISOString();
  await db.prepare('INSERT OR IGNORE INTO team_roster (user_id, updated_at) VALUES (?, ?)').bind(input.id, now).run();
  const saved = await db.prepare(`UPDATE team_roster SET active = CASE WHEN ? THEN ? ELSE active END,
    rental_deduction_start = CASE WHEN ? THEN ? ELSE rental_deduction_start END,
    revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?
    RETURNING user_id, active, revision, rental_deduction_start`)
    .bind(Number(changeActive), input.active ? 1 : 0, Number(changeStart), input.rentalDeductionStart ?? null, now, input.id, input.revision).first();
  if (!saved) fail(409, 'This person’s settings changed on another device. Reload the team and try again.');
  return { id: saved.user_id, active: Boolean(saved.active), revision: saved.revision, rentalDeductionStart: saved.rental_deduction_start };
}
