// A device passkey unlocks an encrypted local copy of the existing dashboard
// password. The password, PRF output and encryption key are never persisted in
// plaintext. This is local vault encryption, not a new server authentication
// protocol: the decrypted password must still open the current dashboard.
const prefix = "smooth-quick-sign-in:v1:";
const remembered = "smooth-last-profile";
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = value => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
const random = size => crypto.getRandomValues(new Uint8Array(size));
const identity = id => typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id);
const bytes = (value, min, max = min) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= max * 2 && decode(value).length >= min && decode(value).length <= max;

export function rememberProfile(id) {
  if (identity(id)) { try { localStorage.setItem(remembered, id); } catch { /* Password login also works without storage. */ } }
}
export function rememberedProfile() {
  try { const id = localStorage.getItem(remembered); return identity(id) ? id : null; } catch { return null; }
}
export function quickSignInRecord(id) {
  try {
    if (!identity(id)) return null;
    const raw = localStorage.getItem(prefix + id);
    if (!raw || raw.length > 12_000) return null;
    const record = JSON.parse(raw);
    return record.version === 1 && record.profileId === id && record.origin === location.origin &&
      bytes(record.credentialId, 1, 1024) && bytes(record.salt, 32) && bytes(record.iv, 12) && bytes(record.ciphertext, 32, 4096) ? record : null;
  } catch { return null; }
}
export function forgetQuickSignIn(id) {
  localStorage.removeItem(prefix + id);
}
export async function supportsQuickSignIn() {
  try { return Boolean(globalThis.isSecureContext && globalThis.PublicKeyCredential && navigator.credentials &&
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
const binding = record => new TextEncoder().encode(JSON.stringify(["smooth-quick-sign-in:v1", record.origin, record.profileId, record.credentialId]));
async function keyFor(secret, record) {
  if (!secret || secret.byteLength !== 32) throw new Error("This device’s passkey provider cannot enable quick sign-in. Use your password or try Safari with iCloud Keychain.");
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: decode(record.salt), info: binding(record) }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function passkeySecret(record) {
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: random(32), rpId: location.hostname, timeout: 60_000, userVerification: "required",
    allowCredentials: [{ type: "public-key", id: decode(record.credentialId) }],
    extensions: { prf: { eval: { first: decode(record.salt) } } },
  } });
  if (!credential || encode(credential.rawId) !== record.credentialId) throw new Error("Choose the passkey you set up for this profile.");
  return credential.getClientExtensionResults().prf?.results?.first;
}
export async function enableQuickSignIn(profile, password) {
  if (!identity(profile.id) || typeof password !== "string" || password.length < 16 || password.length > 2000) throw new Error("Sign in with your password before setting up quick sign-in.");
  if (!await supportsQuickSignIn()) throw new Error("Quick sign-in isn’t supported on this device. Password sign-in is still available.");
  // Check storage before prompting, without ever writing the password.
  localStorage.setItem(prefix + "storage-check", "1"); localStorage.removeItem(prefix + "storage-check");
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: random(32), rp: { id: location.hostname, name: "Smooth Studios" },
    user: { id: new TextEncoder().encode(`smooth:${profile.id}`), name: profile.id === "owner" ? "smooth" : profile.id, displayName: profile.label },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
    attestation: "none", timeout: 60_000, extensions: { prf: {} },
  } });
  if (!credential || !credential.getClientExtensionResults().prf?.enabled) throw new Error("This passkey provider doesn’t support quick sign-in for the dashboard. Use your password or try Safari with iCloud Keychain.");
  const record = { version: 1, profileId: profile.id, origin: location.origin, credentialId: encode(credential.rawId), salt: encode(random(32)), iv: encode(random(12)) };
  // Confirm the newly created passkey actually returns a usable encryption key
  // before saving anything or displaying success.
  const key = await keyFor(await passkeySecret(record), record);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: decode(record.iv), additionalData: binding(record) }, key, new TextEncoder().encode(password));
  localStorage.setItem(prefix + profile.id, JSON.stringify({ ...record, ciphertext: encode(ciphertext) }));
  rememberProfile(profile.id);
}
export async function quickSignInPassword(id) {
  const record = quickSignInRecord(id);
  if (!record) throw new Error("Sign in with your password, then set up quick sign-in on this device.");
  const key = await keyFor(await passkeySecret(record), record);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(record.iv), additionalData: binding(record) }, key, decode(record.ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch { throw new Error("Quick sign-in couldn’t unlock this profile. Sign in with your password and set it up again."); }
}
export function quickSignInError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "AbortError") return "Quick sign-in was cancelled or timed out. Try again or use your password.";
  if (error?.name === "SecurityError") return "Open dashboard.smoothstudios.co directly to use quick sign-in.";
  if (error?.name === "QuotaExceededError") return "This browser couldn’t save quick sign-in. Allow website storage or use your password.";
  return error?.message || "Quick sign-in is unavailable. Use your password to continue.";
}
