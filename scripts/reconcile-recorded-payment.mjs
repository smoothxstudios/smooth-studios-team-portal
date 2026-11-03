// Reconcile one explicitly reported payment. Never print credentials or pay amounts.
import { readFile } from 'node:fs/promises';
import { teamToken } from '../lib/team-auth.mjs';
import { TEAM_API_URL } from '../lib/team-schedule.mjs';

const [employeeId,through,id]=process.argv.slice(2);
const ledger=JSON.parse(await readFile(new URL('../data/payout-ledger.json',import.meta.url),'utf8'));
const token=await teamToken(process.env.DASHBOARD_PASSWORD_OWNER,'owner');
async function request(path,data){
  const response=await fetch(`${TEAM_API_URL}${path}`,{method:data?'POST':'GET',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Recorded payment reconciliation failed (${response.status}); no replacement payment was sent.`);
  return response.json();
}
const saved=await request(`/payroll/payments/${id}`);
if(saved.receipt){process.stdout.write('Recorded payment reconciliation already verified.\n');process.exit(0);}
if(ledger.employees[employeeId]?.paidThrough!==through) throw Error('The reported paid-through record changed; manual review is required.');
const preview=await request(`/payroll/payments/preview?employee=${encodeURIComponent(employeeId)}&through=${through}`);
const result=await request('/payroll/payments',{id,employeeId,through,revision:preview.revision,reviewKey:preview.reviewKey,cashCents:preview.cashCents,method:'Previously paid',note:'Reconciled the owner-reported paid-through action to include all earned work.',allowEmpty:true});
const verified=await request(`/payroll/payments/${id}`);
if(verified.receipt?.id!==result.receipt.id)throw Error('The saved reconciliation receipt was not verified.');
const remaining=await request(`/payroll/payments/preview?employee=${encodeURIComponent(employeeId)}&through=${through}`);
if(remaining.grossCents!==0)throw Error('Some eligible work remains unsettled; review is required.');
process.stdout.write(`Recorded payment reconciliation verified: ${preview.items.filter(i=>i.kind==='rental').length} appointment items and ${preview.items.filter(i=>i.kind==='creative').length} added/creative pay items. No earned pay remains outstanding through the reported date. No money was transferred.\n`);
