import type { DashboardPayload, EncryptedEnvelope } from "@/lib/dashboard-types";

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function decryptDashboard(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<DashboardPayload> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: decodeBase64(envelope.salt),
      iterations: envelope.iterations,
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(envelope.iv) },
    key,
    decodeBase64(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as DashboardPayload;
}
