import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createECDH, hkdfSync, createDecipheriv } from "node:crypto";
import worker from "../../team-api/worker.mjs";
import { TEAM } from "../../lib/team-schedule.mjs";
import { teamToken, tokenHash } from "../../lib/team-auth.mjs";

const folder = new URL("../../team-api/migrations/", import.meta.url);
const migrations = readdirSync(folder).filter(name => name.endsWith(".sql")).sort().map(name => readFileSync(new URL(name, folder), "utf8"));
const tokens = Object.fromEntries(await Promise.all([...TEAM.map(p => p.id), "sync"].map(async id => [id, await teamToken(`synthetic-notification-tests-${id}`, id)])));
const hashes = Object.fromEntries(await Promise.all(Object.entries(tokens).map(async ([id, token]) => [id, await tokenHash(token)])));
export class D1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); migrations.forEach(sql => this.sqlite.exec(sql)); }
  prepare(sql) {
    const db = this.sqlite; let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      runSync() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      async run() { return this.runSync(); } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.runSync()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
export async function fixture() {
  const DB = new D1(), pending = [];
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const env = { DB, TEAM_TOKEN_HASHES: JSON.stringify(hashes), VAPID_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", vapid.privateKey)) };
  const call = async (user, path = "/engagement", data, method = data === undefined ? "GET" : "POST") => {
    const response = await worker.fetch(new Request(`https://api.example.invalid${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${tokens[user]}`, origin: "https://dashboard.smoothstudios.co" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env, { waitUntil: promise => pending.push(promise) });
    return { status: response.status, data: await response.json() };
  };
  return { DB, env, call, pending, close: () => DB.sqlite.close() };
}
export function device(name) {
  const receiver = createECDH("prime256v1"); receiver.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const keys = { p256dh: receiver.getPublicKey().toString("base64url"), auth: Buffer.from(auth).toString("base64url") };
  return { endpoint: `https://web.push.apple.com/synthetic-${name}`, keys, decrypt(body) {
    const encoded = Buffer.from(body), sender = encoded.subarray(21, 86);
    const ikm = hkdfSync("sha256", receiver.computeSecret(sender), auth, Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), sender]), 32);
    const cek = hkdfSync("sha256", ikm, encoded.subarray(0, 16), Buffer.from("Content-Encoding: aes128gcm\0"), 16);
    const nonce = hkdfSync("sha256", ikm, encoded.subarray(0, 16), Buffer.from("Content-Encoding: nonce\0"), 12);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(encoded.subarray(-16));
    const plain = Buffer.concat([decipher.update(encoded.subarray(86, -16)), decipher.final()]);
    if (plain.at(-1) !== 2) throw new Error("Invalid Web Push record delimiter");
    return JSON.parse(plain.subarray(0, -1).toString());
  } };
}
export async function answerCurrent(f, user = "jordyn") {
  const result = await f.call(user);
  if (result.status !== 200 || !result.data.available) throw new Error(`No question: ${JSON.stringify(result)}`);
  const state = result.data, tier = state.quiz.find(item => item.question.id === state.currentQuestionId).question.tier;
  const question = JSON.parse(f.DB.sqlite.prepare("SELECT data FROM team_quiz_offers WHERE user_id = ? AND day = ? AND tier = ?").get(user, state.day, tier).data);
  return f.call(user, "/engagement/answer", { day: state.day, tier, questionId: question.id, optionId: question.correctOptionId });
}
