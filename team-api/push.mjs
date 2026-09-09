import { base64url, unbase64url } from "../lib/team-auth.mjs";

export function pushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Unsupported push endpoint.");
  const url = new URL(value);
  const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !(allowed.includes(url.hostname) || url.hostname.endsWith(".notify.windows.com"))) {
    throw new Error("This browser's push service is not supported yet.");
  }
  return url.href;
}

export function publicPushKey(jwk) {
  return base64url(new Uint8Array([4, ...unbase64url(jwk.x), ...unbase64url(jwk.y)]));
}

export async function vapidAuthorization(endpoint, jwk, now = Date.now()) {
  const encode = value => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(pushEndpoint(endpoint)).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: "https://smoothxstudios.github.io/smooth-studios-team-portal/",
  })}`;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `vapid t=${input}.${base64url(new Uint8Array(signature))}, k=${publicPushKey(jwk)}`;
}

// Empty pushes are intentional: the SW displays a generic alert. No private
// payload is sent to a push provider. VAPID still authenticates the sender.
export async function deliverPush(endpoint, jwk, send = fetch) {
  const url = pushEndpoint(endpoint);
  const response = await send(url, {
    method: "POST", redirect: "error", body: new Uint8Array(0),
    headers: { Authorization: await vapidAuthorization(url, jwk), TTL: "86400", Urgency: "high", Topic: "smooth-schedule" },
    signal: AbortSignal.timeout(8000),
  });
  if (response.body) await response.body.cancel();
  const host = new URL(url).hostname;
  const provider = host === "web.push.apple.com" ? "Apple" : host === "fcm.googleapis.com" ? "Google" : host === "updates.push.services.mozilla.com" ? "Firefox" : "Windows";
  return { status: response.status, provider, accepted: response.status === 201 || response.status === 202,
    expired: response.status === 404 || response.status === 410 };
}

export function pushDeliveryMessage(result) {
  if (result.accepted) return `${result.provider} accepted the test for this device. If no alert appears, check this app’s notification settings and Focus / Do Not Disturb.`;
  if (result.expired) return "This device’s notification subscription expired. Enable notifications again, then send another test.";
  if ([401, 403].includes(result.status)) return `${result.provider} rejected notification authorization (HTTP ${result.status}). Disable this device, enable it again, and retry.`;
  if (result.status === 429) return `${result.provider} is limiting notifications. Wait a minute, then try again.`;
  return `${result.provider} could not accept the notification (HTTP ${result.status}). Please share this message with Smooth so delivery can be checked.`;
}

export async function flushAlerts(env, send = fetch) {
  if (!env.VAPID_JWK) return;
  const jwk = JSON.parse(env.VAPID_JWK);
  const alerts = (await env.DB.prepare("SELECT * FROM team_alerts WHERE due_at <= ? AND attempts < 4 LIMIT 4").bind(Date.now()).all()).results;
  for (const alert of alerts) {
    const devices = (await env.DB.prepare("SELECT * FROM team_devices WHERE user_id = ? LIMIT 3").bind(alert.user_id).all()).results;
    let retry = false;
    for (const device of devices) {
      try {
        const result = await deliverPush(device.endpoint, jwk, send);
        if (result.expired) await env.DB.prepare("DELETE FROM team_devices WHERE id = ? AND user_id = ?").bind(device.id, device.user_id).run();
        else if (!result.accepted) retry = true;
      } catch { retry = true; }
    }
    if (retry) {
      await env.DB.prepare("UPDATE team_alerts SET attempts = attempts + 1, due_at = ? WHERE user_id = ? AND id = ?")
        .bind(Date.now() + 5 * 60_000, alert.user_id, alert.id).run();
    } else {
      await env.DB.prepare("DELETE FROM team_alerts WHERE user_id = ? AND id = ?").bind(alert.user_id, alert.id).run();
    }
  }
}
