import { readFile } from 'node:fs/promises';
import { privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { decryptPayload, encryptPayload } from '../.current/scripts/lib/dashboard-data.mjs';
import { applyGuidePatch, sameGuideline, MAX_GUIDELINE_UPDATE_BYTES } from '../.current/lib/studio-guidelines.mjs';
import { teamToken } from '../.current/lib/team-auth.mjs';
import { TEAM_API_URL } from '../.current/lib/team-schedule.mjs';

const root=process.cwd();
const password=process.env.DASHBOARD_PASSWORD_OWNER;
if(!password) throw new Error('Owner credentials are required.');
const readJson=async p=>JSON.parse(await readFile(path.join(root,p),'utf8'));
const envelope=await readJson('data/reviewed-guidelines.sealed.json');
if(envelope.version!==1) throw new Error('Unsupported reviewed guideline envelope.');
const {privateKey}=decryptPayload(envelope.privateKeyEnvelope,password);
const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.key,'base64'));
const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
const packet=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));
if(packet.id!=='studio-guidelines-2026-11-16-shifts' || packet.patch?.mode!=='patch' || !Array.isArray(packet.answeredQuestionIds)) throw new Error('Invalid reviewed update.');
if(Buffer.byteLength(JSON.stringify(packet.patch))>MAX_GUIDELINE_UPDATE_BYTES) throw new Error('Reviewed update exceeds the publication limit.');
if(packet.answeredQuestionIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))) throw new Error('Invalid question ID.');
const current=decryptPayload(await readJson('.current/public/data/owner.json'),password).rulebook;
const isApplied=packet.patch.upserts.every(entry=>sameGuideline(entry,current.entries.find(item=>item.id===entry.id))) && packet.patch.deleteIds.every(id=>!current.entries.some(item=>item.id===id));
const stage=process.argv[2];
if(stage==='prepare') {
 if(!isApplied) {
  applyGuidePatch(current,packet.patch); // Refuse a stale review before changing any data.
  execFileSync(process.execPath,['scripts/update-guidelines.mjs'],{cwd:path.join(root,'.current'),stdio:'inherit',env:{...process.env,STUDIO_GUIDE_ENVELOPE:JSON.stringify(encryptPayload(packet.patch,password))}});
 } else console.log('The reviewed guidelines are already published; preserving the current revision.');
 const updated=decryptPayload(await readJson('.current/public/data/owner.json'),password).rulebook;
 if(!packet.patch.upserts.every(entry=>sameGuideline(entry,updated.entries.find(item=>item.id===entry.id)))) throw new Error('Published guideline verification failed.');
 console.log(`Verified ${packet.patch.upserts.length} reviewed entries in ${updated.entries.length} guidelines.`);
} else if(stage==='answer-questions') {
 if(!isApplied) throw new Error('Publish the reviewed answers before updating the question queue.');
 const liveResponse=await fetch(`https://dashboard.smoothstudios.co/data/owner.json?review=${Date.now()}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!liveResponse.ok) throw new Error('The published dashboard could not be verified.');
 const live=decryptPayload(await liveResponse.json(),password).rulebook;
 if(!packet.patch.upserts.every(entry=>sameGuideline(entry,live.entries.find(item=>item.id===entry.id)))) throw new Error('The live dashboard does not contain the reviewed answers yet.');
 const token=await teamToken(password,'owner');
 for(const id of packet.answeredQuestionIds) {
  const entry=current.entries.find(item=>item.id===`question-submitted-${id}`);
  if(!entry || !packet.patch.upserts.some(item=>sameGuideline(item,entry))) throw new Error('Submitted question has no verified published answer.');
  const response=await fetch(`${TEAM_API_URL}/guidelines/questions/${id}`,{method:'PATCH',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({status:'answered'})});
  if(!response.ok) throw new Error(`Question status could not be updated (${response.status}).`);
 }
 const response=await fetch(`${TEAM_API_URL}/guidelines/questions`,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:`Bearer ${token}`}});
 if(!response.ok) throw new Error('The question queue could not be verified.');
 const {questions}=await response.json();
 if(!packet.answeredQuestionIds.every(id=>questions.some(q=>q.id===id && q.status==='answered'))) throw new Error('A submitted question is still open.');
 console.log(`Verified the live dashboard and marked ${packet.answeredQuestionIds.length} submitted questions answered.`);
} else throw new Error('Choose prepare or answer-questions.');
