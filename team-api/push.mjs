import { base64url, unbase64url } from "../lib/team-auth.mjs";
import { encryptPush } from "./push-encryption.mjs";
import { notificationDetails } from "./notification-content.mjs";

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

// Details are allowlisted and encrypted separately for each device. Legacy
// registrations retain generic alerts until a dashboard visit adds keys.
export async function deliverPush(endpoint, jwk, send = fetch, { keys, kind = "schedule", ttl = 86400, details, notificationId, receipt } = {}) {
  const url = pushEndpoint(endpoint);
  if (!["schedule", "assignment", "creative", "quiz", "test", "notice"].includes(kind)) throw new Error("Invalid notification type.");
  const eventId = typeof notificationId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(notificationId) ? notificationId : null;
  // Existing installed service workers already understand schedule payloads.
  // Preserve the actual reminder text while newer workers add its destination.
  const content = { type: kind === "notice" ? "schedule" : kind, ...notificationDetails(details),
    ...(["alerts", "settings", "scheduling", "creative", "availability", "payouts", "quiz"].includes(details?.target) ? { target: details.target } : {}),
    ...(eventId ? { id: eventId } : {}),
    ...(typeof receipt === "string" && /^[A-Za-z0-9_-]{43}$/.test(receipt) ? { receipt } : {}) };
  const payload = keys ? await encryptPush(keys, new TextEncoder().encode(JSON.stringify(content))) : new Uint8Array(0);
  // Web Push topics are public, opaque, and limited to 32 URL-safe characters.
  // A retry replaces its own pending alert; separate bookings stay separate.
  const topic = eventId ? base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventId)))).slice(0, 32) : `smooth-${kind}`;
  const response = await send(url, {
    // Workerd rejects redirect: "error" before sending. Manual mode returns
    // redirects as rejected deliveries without forwarding VAPID credentials.
    method: "POST", redirect: "manual", body: payload,
    headers: { Authorization: await vapidAuthorization(url, jwk), TTL: String(Math.max(0, Math.min(86400, Math.floor(ttl)))),
      Urgency: kind === "quiz" ? "normal" : "high", Topic: topic,
      ...(keys ? { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" } : {}) },
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

// A short atomic lease prevents overlapping requests/cron ticks from sending
// the same alert together. Successful devices are never retried because a
// different device failed. A lost provider response can still require a retry.
const retryMinutes = [1, 2, 5, 10, 15, 30, 60, 60];
export async function sendAlert(env, alert, send = fetch, now = Date.now()) {
  let details;
  try { details = JSON.parse(alert.payload); } catch { /* Legacy and quiz alerts use the default copy. */ }
  const devices = (await env.DB.prepare(`SELECT * FROM team_devices WHERE user_id = ?
    ${alert.kind === "quiz" ? "AND p256dh IS NOT NULL AND auth IS NOT NULL" : ""} LIMIT 3`).bind(alert.user_id).all()).results;
  await Promise.all(devices.map(async device => {
    await env.DB.prepare(`INSERT OR IGNORE INTO team_push_deliveries (alert_id, device_id, created_at, receipt_token) VALUES (?, ?, ?, ?)`)
      .bind(alert.id, device.id, now, base64url(crypto.getRandomValues(new Uint8Array(32)))).run();
    const claim = await env.DB.prepare(`UPDATE team_push_deliveries SET attempts = attempts + 1, lease_until = ?, result = 'sending', receipt_token = COALESCE(receipt_token, ?)
      WHERE alert_id = ? AND device_id = ? AND completed_at IS NULL AND received_at IS NULL AND attempts < 8 AND due_at <= ? AND lease_until <= ?`)
      .bind(now + 60_000, base64url(crypto.getRandomValues(new Uint8Array(32))), alert.id, device.id, now, now).run();
    if (!claim.meta.changes) return;
    const delivery = await env.DB.prepare("SELECT * FROM team_push_deliveries WHERE alert_id = ? AND device_id = ?").bind(alert.id, device.id).first();
    const expiresAt = alert.expires_at ?? ((alert.notification_created_at ?? alert.created_at ?? delivery.created_at) + 86400_000);
    let completed = false, outcome = "retrying", providerStatus = null;
    if (expiresAt <= now) { completed = true; outcome = "expired"; }
    else try {
      const result = await deliverPush(device.endpoint, JSON.parse(env.VAPID_JWK), send, {
        keys: device.p256dh && device.auth ? { p256dh: device.p256dh, auth: device.auth } : null,
        kind: alert.kind ?? "schedule", ttl: Math.max(0, Math.min(alert.kind === "quiz" ? 300 : 86400, (expiresAt - now) / 1000)),
        details, notificationId: alert.id, receipt: delivery.receipt_token,
      });
      providerStatus = result.status;
      completed = result.accepted || result.expired || [400, 401, 403, 413].includes(result.status);
      outcome = result.accepted ? "accepted" : result.expired ? "expired" : completed ? "failed" : "retrying";
      if (result.accepted) await env.DB.prepare("UPDATE team_inbox SET push_accepted_at = ? WHERE id = ? AND push_accepted_at IS NULL").bind(now, alert.id).run();
      if (result.expired) await env.DB.prepare("DELETE FROM team_devices WHERE id = ? AND user_id = ?").bind(device.id, device.user_id).run();
    } catch { /* Retry transient errors; endpoints and receipt tokens stay private. */ }
    if (!completed && delivery.attempts >= 8) { completed = true; outcome = "failed"; }
    const dueAt = now + retryMinutes[Math.min(delivery.attempts - 1, 7)] * 60_000;
    await env.DB.prepare(`UPDATE team_push_deliveries SET completed_at = CASE WHEN received_at IS NOT NULL THEN COALESCE(completed_at, ?) ELSE ? END,
      lease_until = 0, due_at = ?, result = CASE WHEN received_at IS NOT NULL THEN 'received' ELSE ? END, provider_status = ?
      WHERE alert_id = ? AND device_id = ? AND attempts = ?`).bind(now, completed ? now : null, dueAt, outcome, providerStatus, alert.id, device.id, delivery.attempts).run();
  }));
  const pending = await env.DB.prepare(`SELECT MIN(MAX(p.due_at, p.lease_until)) AS nextDue FROM team_push_deliveries p
    JOIN team_devices d ON d.id = p.device_id WHERE p.alert_id = ? AND d.user_id = ?
    AND p.completed_at IS NULL AND (p.attempts < 8 OR p.lease_until > ?)`)
    .bind(alert.id, alert.user_id, now).first();
  return pending.nextDue ?? null;
}

export async function flushAlerts(env, send = fetch) {
  if (!env.VAPID_JWK) return;
  const queues = ["team_notification_events", "team_alerts"];
  const alerts = (await Promise.all(queues.map(async queue =>
    (await env.DB.prepare(`SELECT q.*, i.created_at AS notification_created_at, i.expires_at FROM ${queue} q LEFT JOIN team_inbox i ON i.id = q.id WHERE q.due_at <= ? ORDER BY q.due_at LIMIT 8`).bind(Date.now()).all()).results.map(alert => ({ ...alert, queue }))
  ))).flat();
  await Promise.all(alerts.map(async alert => {
    const retry = await sendAlert(env, alert, send);
    if (retry) {
      await env.DB.prepare(`UPDATE ${alert.queue} SET attempts = attempts + 1, due_at = ? WHERE user_id = ? AND id = ?`)
        .bind(retry, alert.user_id, alert.id).run();
    } else {
      await env.DB.prepare(`DELETE FROM ${alert.queue} WHERE user_id = ? AND id = ?`).bind(alert.user_id, alert.id).run();
    }
  }));
}
