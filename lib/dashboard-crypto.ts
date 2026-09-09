import type { DashboardPayload, EncryptedEnvelope } from "@/lib/dashboard-types";

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function toArrayBuffer(value: Uint8Array) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

async function derivePasswordKey(password: string, salt: Uint8Array, iterations: number, usages: KeyUsage[]) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export async function decryptDashboard(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<DashboardPayload> {
  const key = await derivePasswordKey(password, decodeBase64(envelope.salt), envelope.iterations, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(decodeBase64(envelope.iv)) },
    key,
    decodeBase64(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as DashboardPayload;
}

export async function encryptWorkflowPayload(payload: unknown, password: string): Promise<EncryptedEnvelope> {
  const iterations = 310_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePasswordKey(password, salt, iterations, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: encodeBase64(toArrayBuffer(salt)),
    iv: encodeBase64(toArrayBuffer(iv)),
    ciphertext: encodeBase64(ciphertext),
  };
}
