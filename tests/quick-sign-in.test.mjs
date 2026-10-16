import test from "node:test";
import assert from "node:assert/strict";
import { enableQuickSignIn, reconnectQuickSignIn, quickSignInPassword, quickSignInRecord, forgetQuickSignIn, rememberProfile, rememberedProfile } from "../lib/quick-sign-in.mjs";

const values = new Map();
let secret = new Uint8Array(32).fill(7), supported = true, cancel = false;
const rawId = new Uint8Array([1, 2, 3, 4]).buffer;
let selectedId = rawId, selectedProfile = "owner", lastRequest, transports = ["internal", "hybrid"];
Object.defineProperties(globalThis, {
  isSecureContext: { configurable: true, value: true },
  location: { configurable: true, value: { origin: "https://dashboard.smoothstudios.co", hostname: "dashboard.smoothstudios.co" } },
  localStorage: { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } },
  PublicKeyCredential: { configurable: true, value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true } },
  navigator: { configurable: true, value: { credentials: {
    async create(options) {
      assert.equal(options.publicKey.authenticatorSelection.userVerification, "required");
      assert.equal(options.publicKey.rp.id, location.hostname);
      assert.equal(options.publicKey.user.name, "smooth");
      return { rawId, response: { getTransports: () => transports }, getClientExtensionResults: () => ({ prf: { enabled: supported } }) };
    },
    async get(options) {
      lastRequest = options.publicKey;
      if (cancel) throw new DOMException("Cancelled", "NotAllowedError");
      assert.equal(options.publicKey.userVerification, "required");
      assert.equal(options.publicKey.challenge.length, 32);
      assert.equal(options.publicKey.extensions.prf.eval.first.length, 32);
      return { rawId: selectedId, response: { userHandle: new TextEncoder().encode(`smooth:${selectedProfile}`) }, getClientExtensionResults: () => ({ prf: { results: { first: supported ? secret.buffer : undefined } } }) };
    },
  } } },
});
const profile = { id: "owner", label: "Smooth" }, password = "synthetic-owner-password-only";
test.beforeEach(() => { values.clear(); secret = new Uint8Array(32).fill(7); supported = true; cancel = false; selectedId = rawId; selectedProfile = "owner"; lastRequest = null; transports = ["internal", "hybrid"]; });
test("Smooth enrollment stores only an encrypted vault and requires device verification to reopen", async () => {
  await enableQuickSignIn(profile, password);
  assert.equal(rememberedProfile(), "owner");
  assert.ok(quickSignInRecord("owner"));
  assert.ok(!JSON.stringify([...values]).includes(password));
  assert.equal(await quickSignInPassword("owner"), password);
  assert.equal(quickSignInRecord("jordyn"), null);
  forgetQuickSignIn("owner"); assert.equal(quickSignInRecord("owner"), null);
});
test("wrong PRF keys, changed origins, and tampering cannot open stored passwords", async () => {
  await enableQuickSignIn(profile, password);
  secret = new Uint8Array(32).fill(8);
  await assert.rejects(() => quickSignInPassword("owner"), /couldn’t unlock/);
  const key = "smooth-quick-sign-in:v1:owner", record = JSON.parse(values.get(key));
  values.set(key, JSON.stringify({ ...record, origin: "https://wrong.invalid" }));
  assert.equal(quickSignInRecord("owner"), null);
  values.set(key, JSON.stringify({ ...record, ciphertext: "not!base64" }));
  assert.equal(quickSignInRecord("owner"), null);
});
test("unsupported PRF and cancelled confirmation never save a usable enrollment", async () => {
  supported = false;
  await assert.rejects(() => enableQuickSignIn(profile, password), /doesn’t support/);
  assert.equal(quickSignInRecord("owner"), null);
  supported = true; cancel = true;
  await assert.rejects(() => enableQuickSignIn(profile, password), /Cancelled/);
  assert.equal(quickSignInRecord("owner"), null);
  rememberProfile("../invalid"); assert.equal(rememberedProfile(), null);
});

test("sign-in uses the saved credential transports and old vaults remain readable", async () => {
  await enableQuickSignIn(profile, password);
  assert.deepEqual(quickSignInRecord("owner").transports, ["internal", "hybrid"]);
  await quickSignInPassword("owner");
  assert.deepEqual(lastRequest.hints, ["client-device"]);
  assert.deepEqual(lastRequest.allowCredentials[0].transports, ["internal", "hybrid"]);
  const record = quickSignInRecord("owner");
  delete record.transports;
  values.set("smooth-quick-sign-in:v1:owner", JSON.stringify(record));
  assert.equal(await quickSignInPassword("owner"), password);
  assert.equal(lastRequest.allowCredentials[0].transports, undefined);
});

test("reconnecting a saved passkey repairs a stale local credential without creating another passkey", async () => {
  await enableQuickSignIn(profile, password);
  const previous = quickSignInRecord("owner");
  selectedId = new Uint8Array([9, 8, 7, 6]).buffer;
  secret = new Uint8Array(32).fill(9);
  await reconnectQuickSignIn(profile, password);
  assert.deepEqual(lastRequest.allowCredentials, []);
  assert.deepEqual(lastRequest.hints, ["client-device"]);
  const repaired = quickSignInRecord("owner");
  assert.notEqual(repaired.credentialId, previous.credentialId);
  assert.notEqual(repaired.salt, previous.salt);
  assert.notEqual(repaired.ciphertext, previous.ciphertext);
  assert.ok(!JSON.stringify([...values]).includes(password));
  assert.equal(await quickSignInPassword("owner"), password);
  assert.deepEqual([...lastRequest.allowCredentials[0].id], [9, 8, 7, 6]);
});

test("wrong-account passkeys, cancelled recovery, and missing encryption support preserve the existing vault", async () => {
  await enableQuickSignIn(profile, password);
  const saved = values.get("smooth-quick-sign-in:v1:owner");
  selectedProfile = "jordyn";
  await assert.rejects(() => reconnectQuickSignIn(profile, password), /Choose the saved passkey for Smooth/);
  assert.equal(values.get("smooth-quick-sign-in:v1:owner"), saved);
  selectedProfile = "owner"; cancel = true;
  await assert.rejects(() => reconnectQuickSignIn(profile, password), /Cancelled/);
  assert.equal(values.get("smooth-quick-sign-in:v1:owner"), saved);
  cancel = false; supported = false;
  await assert.rejects(() => reconnectQuickSignIn(profile, password), /cannot enable quick sign-in/);
  assert.equal(values.get("smooth-quick-sign-in:v1:owner"), saved);
  supported = true;
  assert.equal(await quickSignInPassword("owner"), password);
});
