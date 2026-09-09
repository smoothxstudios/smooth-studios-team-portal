// Purpose-separated from dashboard encryption. Only a SHA-256 digest of this
// bearer is stored in the API's secrets; plaintext passwords never leave login.
export async function teamToken(password, id) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(`smooth-studios-team-portal:team-api:v1:${id}`));
  return base64url(new Uint8Array(signature));
}

export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function unbase64url(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}

export async function tokenHash(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
