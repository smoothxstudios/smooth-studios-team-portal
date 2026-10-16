import test from "node:test";
import assert from "node:assert/strict";
import { enableQuickSignIn, quickSignInPassword, quickSignInRecord, forgetQuickSignIn, rememberProfile, rememberedProfile } from "../lib/quick-sign-in.mjs";

const values = new Map();
let secret = new Uint8Array(32).fill(7), supported = true, cancel = false;
const rawId = new Uint8Array([1, 2, 3, 4]).buffer;
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
      return { rawId, getClientExtensionResults: () => ({ prf: { enabled: supported } }) };
    },
    async get(options) {
      if (cancel) throw new DOMException("Cancelled", "NotAllowedError");
      assert.equal(options.publicKey.userVerification, "required");
      assert.equal(options.publicKey.challenge.length, 32);
      assert.equal(options.publicKey.extensions.prf.eval.first.length, 32);
      return { rawId, getClientExtensionResults: () => ({ prf: { results: { first: secret.buffer } } }) };
    },
  } } },
});
const profile = { id: "owner", label: "Smooth" }, password = "synthetic-owner-password-only";
test.beforeEach(() => { values.clear(); secret = new Uint8Array(32).fill(7); supported = true; cancel = false; });
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
