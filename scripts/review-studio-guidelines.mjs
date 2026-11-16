import { readFile, writeFile } from 'node:fs/promises';
import { createCipheriv, publicEncrypt, randomBytes, constants, generateKeyPairSync } from 'node:crypto';
import { decryptPayload, encryptPayload } from './lib/dashboard-data.mjs';
import { teamToken } from '../lib/team-auth.mjs';
import { TEAM_API_URL } from '../lib/team-schedule.mjs';

const password = process.env.DASHBOARD_PASSWORD_OWNER;
if (!password) throw new Error('Owner authentication is unavailable.');
const payload = decryptPayload(JSON.parse(await readFile('.current/public/data/owner.json', 'utf8')), password);
const token = await teamToken(password, 'owner');
async function read(path) {
  const response = await fetch(TEAM_API_URL + path, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Guideline review request failed: ' + response.status);
  return response.json();
}
const [questions, reference] = await Promise.all([read('/guidelines/questions'), read('/studio-reference')]);
const data = { rulebook: payload.rulebook, questions: questions.questions, reference, capturedAt: new Date().toISOString() };
const publicKey = JSON.parse(await readFile('data/guideline-review-public-key.json', 'utf8'));
const key = randomBytes(32), iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
const envelope = { key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
await writeFile('guideline-review.enc.json', JSON.stringify(envelope));
console.log('Encrypted the current studio guidelines, question queue, and studio reference for review.');

const publishing = generateKeyPairSync('rsa', { modulusLength: 3072 });
await writeFile('guideline-publish-key.json', JSON.stringify({
  publicKey: publishing.publicKey.export({ type: 'spki', format: 'pem' }),
  privateKeyEnvelope: encryptPayload({ privateKey: publishing.privateKey.export({ type: 'pkcs8', format: 'pem' }) }, password)
}));
console.log('Prepared an owner-encrypted publication key; no password or private key is exported in plaintext.');
