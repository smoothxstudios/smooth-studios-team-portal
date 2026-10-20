// Read-only checks for the requested rollback. No alerts or assignments are sent.
import { readFile } from 'node:fs/promises';
import { decryptPayload } from './lib/dashboard-data.mjs';
import { readTeamSettings, teamPasswords } from './lib/team-settings.mjs';
import { teamToken } from '../lib/team-auth.mjs';
import { TEAM_API_URL } from '../lib/team-schedule.mjs';

const root = new URL('..', import.meta.url).pathname;
const config = JSON.parse(await readFile(new URL('../config/studio.config.json', import.meta.url), 'utf8'));
const settings = await readTeamSettings(root, config, process.env.DASHBOARD_PASSWORD_OWNER);
const passwords = teamPasswords(config, settings);
const { profiles } = JSON.parse(await readFile(new URL('../public/data/access.json', import.meta.url), 'utf8'));
for (const { id, role } of profiles) {
  const password = passwords[id];
  if (!password) throw new Error('A restored account is missing its current credential.');
  const envelope = JSON.parse(await readFile(new URL(`../public/data/${id}.json`, import.meta.url), 'utf8'));
  const payload = decryptPayload(envelope, password);
  if (payload.user?.id !== id || payload.role !== role || payload.history?.deferred || !Array.isArray(payload.rentals)) throw new Error('Restored account data is invalid.');
  const proof = await teamToken(password, id);
  const response = await fetch(`${TEAM_API_URL}/schedule`, { cache: 'no-store', redirect: 'error',
    headers: { authorization: `Bearer ${proof}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Restored scheduling access failed (${response.status}).`);
  const schedule = await response.json();
  if (!Array.isArray(schedule.appointments) || !Array.isArray(schedule.assignments)) throw new Error('Restored schedule is incomplete.');
  if (id !== 'owner' && (schedule.assignments.some(item => item.employeeId !== id) ||
      schedule.appointments.some(item => item.acceptedEmployeeIds.some(person => person !== id)))) throw new Error('Restored schedule account isolation failed.');
}
console.log(`Verified v2.41.1 encrypted sign-in data and live scheduling access for ${profiles.length} current accounts.`);
