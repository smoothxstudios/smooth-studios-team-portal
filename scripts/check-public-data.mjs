import { readdir, readFile } from 'node:fs/promises';
const directory = new URL('../public/data/', import.meta.url);
const allowed = new Set(['access.json', 'team-api.json', 'secure-import-key.json']);
for (const name of await readdir(directory)) {
  if (!allowed.has(name)) throw new Error('Private dashboard data must not be published as a website file.');
  const data = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  if (data.ciphertext || data.employees || data.workflowAccess) throw new Error('Private data found in a public website file.');
}
