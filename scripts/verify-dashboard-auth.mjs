import { readFile } from 'node:fs/promises';
import { TEAM_API_URL } from '../lib/team-schedule.mjs';
import { teamToken } from '../lib/team-auth.mjs';
import { expandHomeLedger } from '../lib/dashboard-history.mjs';
import { recognizedRevenue } from '../lib/owner-finances.mjs';
import { decryptPayload } from './lib/dashboard-data.mjs';
import { readTeamSettings, teamPasswords } from './lib/team-settings.mjs';

const root=new URL('..',import.meta.url).pathname;
const config=JSON.parse(await readFile(new URL('../config/studio.config.json',import.meta.url),'utf8'));
const settings=await readTeamSettings(root,config,process.env.DASHBOARD_PASSWORD_OWNER);
const passwords=teamPasswords(config,settings);
async function request(path,token,method='GET',headers={}) {
  return fetch(`${TEAM_API_URL}${path}`,{method,redirect:'error',cache:'no-store',headers:{...headers,...(token?{authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(20_000)});
}
if((await request('/dashboard')).status!==401)throw new Error('Private data must reject signed-out requests.');
for(const [id,password] of Object.entries(passwords)) {
  const proof=await teamToken(password,id);
  if((await request('/dashboard',proof)).status!==401)throw new Error('Dashboard data must require an expiring session.');
  const started=performance.now();
  const login=await request('/auth/session?dashboard=home',proof,'POST');
  if(!login.ok)throw new Error(`Session verification sign-in failed (${login.status}).`);
  const {token,userId,dashboard}=await login.json();
  const initialMs=Math.round(performance.now()-started);
  if(userId!==id || !/^ss1\.[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Session identity verification failed.');
  try {
    if(!dashboard?.envelope || !dashboard.etag)throw new Error('Combined sign-in did not return Home.');
    const home=expandHomeLedger(decryptPayload(dashboard.envelope,password));
    if(home.user?.id!==id || home.role!==(id==='owner'?'owner':'employee'))throw new Error('Home account isolation failed.');
    const unchanged=await request('/dashboard?view=home',token,'GET',{'if-none-match':dashboard.etag});
    if(unchanged.status!==304 || (await unchanged.text()).length!==0)throw new Error('Unchanged Home must not download its payload.');
    const response=await request('/dashboard?id=another-account',token);
    if(!response.ok)throw new Error(`Private dashboard verification failed (${response.status}).`);
    const fullEnvelope=await response.json(), payload=decryptPayload(fullEnvelope,password);
    const total=p=>p.rentals.reduce((sum,r)=>sum+recognizedRevenue(r),0);
    if(home.rentals.length!==payload.rentals.length || total(home)!==total(payload))throw new Error("Home ledger did not preserve historical totals.");
    if(id==="owner") {
      const homeBytes=Buffer.byteLength(JSON.stringify(dashboard.envelope)),fullBytes=Buffer.byteLength(JSON.stringify(fullEnvelope));
      process.stdout.write(`Owner initial payload: ${homeBytes} bytes; full history: ${fullBytes} bytes; reduction: ${Math.round((1-homeBytes/fullBytes)*100)}%; combined sign-in: ${initialMs} ms from CI.\n`);
    }
    if(payload.user?.id!==id || payload.role!==(id==='owner'?'owner':'employee'))throw new Error('Private dashboard account isolation failed.');
    if(!(await request('/auth/session',token,'PATCH')).ok)throw new Error('Session renewal verification failed.');
  } finally {
    if(!(await request('/auth/session',token,'DELETE')).ok)throw new Error('Session revocation verification failed.');
  }
  if((await request('/dashboard?view=home',token,'GET',{'if-none-match':dashboard.etag})).status!==401)throw new Error('Revoked session was accepted.');
}
// Metadata only. Never print decrypted account data, credentials or bearers.
process.stdout.write(`Verified combined sign-in, conditional reads, historical totals, account isolation, renewal and sign-out for ${Object.keys(passwords).length} active accounts.\n`);
