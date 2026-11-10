// One-time, owner-requested follow-up. Only notifications can be written.
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, createCipheriv, publicEncrypt } from 'node:crypto';
import { cloudflareQuery } from './send-calendar-connect-reminder.mjs';
import { TEAM, TEAM_API_URL, localInstant } from '../lib/team-schedule.mjs';
import { teamToken } from '../lib/team-auth.mjs';
import { paymentNotification } from '../team-api/notification-content.mjs';
const publicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkPqew+uKFRVbon1yFzq1\nX2iKCzFKoU/hUsFm1baaLE+sOoC+FcSBVD/7UDYDl5FnJPRxw5OsbUS7eQo4KuXc\nHWXkxIAg/qzBLmEUH1bOV1Fp6uBHR9XhoQeJZZ73o+imEguYZXYpyvXGEbMRknhX\nNykPxlJW1d3ReriaRPSF2RYT5QeAiCu7FVRRfHebeiR+jq6yGRPZJULDY+iEbIsX\ngf6qiba6hvdoZZNS9kjncvOZ5TZkTkCt9RqwjxCbsw9J+fWxmaj2UXVdHAtqboag\nMFbrJoYK/TdvdTaw7HxHwAEc1y1vIfz4tpZ3ckXY1+kB0NVX60yXTmi1ZL5+IJZQ\ncwIDAQAB\n-----END PUBLIC KEY-----\n";
const date = '2026-11-10';
const from = localInstant(`${date}T00:00`);
const cutoff = "2026-11-10T19:24:57.980Z";
const title = paymentNotification('owner').title;
const batch = 'paid-followup-2026-11-10';
function encryptedReport(value) {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const envelope = { key: publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),
    iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64') };
  process.stdout.write(`PRIVATE_PAYMENT_NOTICE_REPORT:${Buffer.from(JSON.stringify(envelope)).toString('base64')}\n`);
}
function noticeId(employee) {
  const h = createHash('sha256').update(`${batch}:${employee}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function main() {
  const mode = process.env.PAYMENT_NOTICE_MODE || 'preview';
  if (!['preview','send','verify'].includes(mode)) throw Error('Invalid follow-up mode.');
  const config = JSON.parse(await readFile(new URL('../team-api/wrangler.jsonc', import.meta.url), 'utf8'));
  const query = await cloudflareQuery({ accountId:process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    apiToken:process.env.CLOUDFLARE_API_TOKEN?.trim(), databaseId:config.d1_databases.find(d=>d.binding==='DB').database_id });
  const payments = (await query(`SELECT 'receipt' AS source, id, employee_id,
      json_extract(data,'$.recordedAt') AS paid_at, json_extract(data,'$.method') AS method
    FROM payroll_receipts WHERE created_at>=? AND created_at<? AND json_extract(data,'$.cashCents')>0
    UNION ALL
    SELECT 'creative', json_extract(p.value,'$.id'), c.employee_id,
      json_extract(p.value,'$.paidAt'), json_extract(p.value,'$.method')
    FROM team_creative_assignments c, json_each(c.data,'$.payments') p
    WHERE json_extract(p.value,'$.paidAt')>=? AND json_extract(p.value,'$.paidAt')<?
      AND COALESCE(json_extract(p.value,'$.cashCents'),json_extract(p.value,'$.amountCents'))>0
      AND json_extract(p.value,'$.receiptId') IS NULL`, [from,cutoff,from,cutoff])).results;
  const excluded = payments.filter(p=>p.source==='receipt' && p.method==='Previously paid');
  const eligible = payments.filter(p=>!excluded.includes(p));
  const recipients = [...new Set(eligible.map(p=>p.employee_id))].sort();
  if (recipients.some(id=>!TEAM.some(p=>p.id===id && id!=='owner'))) throw Error('A payment recipient is not in the current team roster.');
  const prior = (await query(`SELECT id,user_id,created_at,deleted_at,push_accepted_at,push_received_at
    FROM team_inbox WHERE title=? AND created_at>=? AND user_id IN (SELECT value FROM json_each(?))`,
    [title,Date.parse(from),JSON.stringify(recipients)])).results;
  if (mode==='preview') { encryptedReport({mode,date,from,cutoff,payments,excluded,recipients,prior}); return; }
  const expected = JSON.parse(process.env.EXPECTED_RECIPIENTS || '[]').sort();
  if (!expected.length || JSON.stringify(expected)!==JSON.stringify(recipients)) throw Error('Payment recipients changed or have not been reviewed; nothing was sent.');
  const sent = [], skipped = [];
  if (mode==='send') {
    // Each employee has a fixed request ID. A retry verifies the same notice.
    const token = await teamToken(process.env.DASHBOARD_PASSWORD_OWNER,'owner');
    for (const employee of recipients) {
      const id = noticeId(employee);
      const previous = prior.filter(row=>row.user_id===employee);
      if (previous.length) { skipped.push(employee); continue; }
      const payload = paymentNotification(employee);
      let response;
      try { response = await fetch(`${TEAM_API_URL}/notifications`, {method:'POST', redirect:'error',
        signal:AbortSignal.timeout(30000), headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        body:JSON.stringify({id,recipientIds:[employee],title:payload.title,body:payload.body,target:'alerts'}) }); }
      catch { throw Error('The follow-up request could not finish; retry uses the same request ID.'); }
      const result = await response.json().catch(()=>({}));
      if (!response.ok || result.id!==id || result.sent!==true || result.recipientCount!==1) throw Error(`The follow-up could not be verified (HTTP ${response.status}).`);
      sent.push(employee);
    }
    if (sent.length) await new Promise(resolve=>setTimeout(resolve,10000));
  }
  const inbox = (await query(`SELECT id,user_id,title,body,target,created_at,push_accepted_at,push_received_at,deleted_at
    FROM team_inbox WHERE title=? AND created_at>=? AND user_id IN (SELECT value FROM json_each(?))`,
    [title,Date.parse(from),JSON.stringify(recipients)])).results;
  if (recipients.some(employee=>!inbox.some(row=>row.user_id===employee && row.title===title))) throw Error('An intended recipient does not have the saved payment notice.');
  const ids = JSON.stringify(inbox.map(i=>i.id));
  const delivery = (await query(`SELECT alert_id,result,provider_status,attempts,completed_at,received_at
    FROM team_push_deliveries WHERE alert_id IN (SELECT value FROM json_each(?))`,[ids])).results;
  const devices = (await query(`SELECT user_id,COUNT(*) AS devices FROM team_devices
    WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id`,[JSON.stringify(recipients)])).results;
  encryptedReport({mode,date,recipients,sent,skipped,inbox,delivery,devices});
  process.stdout.write('Requested payment notices verified. Recipient and delivery details are encrypted.\n');
}
main().catch(()=>{process.stderr.write('Payment notice follow-up stopped; no private details were logged. Check the reviewed recipient set and retry safely.\n');process.exitCode=1;});
