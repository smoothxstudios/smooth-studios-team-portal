import { readFile } from 'node:fs/promises';
import { TEAM_API_URL } from '../lib/team-schedule.mjs';
import { teamToken } from '../lib/team-auth.mjs';
import { decryptPayload } from './lib/dashboard-data.mjs';
import { readTeamSettings, teamPasswords } from './lib/team-settings.mjs';

const root=new URL('..',import.meta.url).pathname;
const config=JSON.parse(await readFile(new URL('../config/studio.config.json',import.meta.url),'utf8'));
const settings=await readTeamSettings(root,config,process.env.DASHBOARD_PASSWORD_OWNER);
const passwords=teamPasswords(config,settings);
async function request(path,token,method='GET') {
  return fetch(`${TEAM_API_URL}${path}`,{method,redirect:'error',cache:'no-store',headers:token?{authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(20_000)});
}
if((await request('/dashboard')).status!==401)throw new Error('Private data must reject signed-out requests.');
for(const [id,password] of Object.entries(passwords)) {
  const proof=await teamToken(password,id);
  if((await request('/dashboard',proof)).status!==401)throw new Error('Dashboard data must require an expiring session.');
  const login=await request('/auth/session',proof,'POST');
  if(!login.ok)throw new Error(`Session verification sign-in failed (${login.status}).`);
  const {token,userId}=await login.json();
  if(userId!==id || !/^ss1\.[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Session identity verification failed.');
  try {
    const response=await request('/dashboard?id=another-account',token);
    if(!response.ok)throw new Error(`Private dashboard verification failed (${response.status}).`);
    const payload=decryptPayload(await response.json(),password);
    if(payload.user?.id!==id || payload.role!==(id==='owner'?'owner':'employee'))throw new Error('Private dashboard account isolation failed.');
    if(!(await request('/auth/session',token,'PATCH')).ok)throw new Error('Session renewal verification failed.');
  } finally {
    if(!(await request('/auth/session',token,'DELETE')).ok)throw new Error('Session revocation verification failed.');
  }
  if((await request('/identity',token)).status!==401)throw new Error('Revoked session was accepted.');
}
// Metadata only. Never print decrypted account data, credentials or bearers.
process.stdout.write(`Verified private reads, account isolation, renewal and sign-out for ${Object.keys(passwords).length} active accounts.\n`);
