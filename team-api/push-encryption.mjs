import { unbase64url } from "../lib/team-auth.mjs";

const bytes = value => new TextEncoder().encode(value);
const join = (...values) => new Uint8Array(values.flatMap(value => Array.from(value)));

export async function subscriptionKeys(value) {
  if (value == null) return null; // Existing registrations can upgrade on next visit.
  if (typeof value.p256dh !== "string" || typeof value.auth !== "string" ||
      !/^[A-Za-z0-9_-]{87}=?$/.test(value.p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(value.auth)) {
    throw new Error("Invalid push subscription keys.");
  }
  const point = unbase64url(value.p256dh), auth = unbase64url(value.auth);
  if (point.length !== 65 || point[0] !== 4 || auth.length !== 16) throw new Error("Invalid push subscription keys.");
  // WebCrypto also validates that this is a point on P-256.
  await crypto.subtle.importKey("raw", point, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return { p256dh: value.p256dh, auth: value.auth };
}

async function hmac(key, input) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, input));
}

// RFC 8291 / RFC 8188, one aes128gcm record. The ephemeral ECDH key is
// separate from the stable VAPID signing key used by existing subscriptions.
export async function encryptPush(keys, plaintext, material) {
  await subscriptionKeys(keys);
  if (!keys || plaintext.length > 3993) throw new Error("Invalid push payload.");
  const receiver = unbase64url(keys.p256dh);
  const publicKey = await crypto.subtle.importKey("raw", receiver, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sender = material?.sender ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey));
  const salt = material?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, sender.privateKey, 256));
  const keyPrk = await hmac(unbase64url(keys.auth), shared);
  const ikm = await hmac(keyPrk, join(bytes("WebPush: info\0"), receiver, senderPublic, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, bytes("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, bytes("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, join(plaintext, [2])));
  return join(salt, [0, 0, 16, 0, 65], senderPublic, ciphertext);
}
