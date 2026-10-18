import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("Cloudflare runtime sends authenticated pushes and never follows provider redirects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smooth-push-runtime-"));
  try {
    // Generate a disposable key exactly as deployment does. No real devices,
    // credentials, listening sockets, or external network services are used.
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
    await writeFile(join(directory, "push.mjs"), await readFile(new URL("../team-api/push.mjs", import.meta.url)));
    await writeFile(join(directory, "encryption.mjs"), await readFile(new URL("../team-api/push-encryption.mjs", import.meta.url)));
    await writeFile(join(directory, "auth.mjs"), await readFile(new URL("../lib/team-auth.mjs", import.meta.url)));
    await writeFile(join(directory, "notification-content.mjs"), await readFile(new URL("../team-api/notification-content.mjs", import.meta.url)));
    await writeFile(join(directory, "schedule.mjs"), await readFile(new URL("../lib/team-schedule.mjs", import.meta.url)));
    await writeFile(join(directory, "runner.mjs"), `
      import { deliverPush } from "./team-api/push.mjs";
      import { assignmentNotifications } from "./team-api/notification-content.mjs";
      const jwk = ${JSON.stringify(jwk)};
      export default { async test() {
        for (const [host, status, provider] of [
          ["web.push.apple.com", 201, "Apple"],
          ["fcm.googleapis.com", 202, "Google"],
          ["updates.push.services.mozilla.com", 403, "Firefox"],
          ["fixture.notify.windows.com", 410, "Windows"],
          ["web.push.apple.com", 302, "Apple"],
        ]) {
          const result = await deliverPush("https://" + host + "/" + status, jwk);
          if (result.status !== status || result.provider !== provider ||
              result.accepted !== [201, 202].includes(status) || result.expired !== (status === 410)) {
            throw new Error("Unexpected delivery result: " + JSON.stringify(result));
          }
        }
        const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
        const keys = { p256dh: encode(new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey))), auth: encode(crypto.getRandomValues(new Uint8Array(16))) };
        const encrypted = await deliverPush("https://web.push.apple.com/encrypted", jwk, fetch, { keys, kind: "quiz", ttl: 300 });
        if (!encrypted.accepted) throw new Error("Workerd encrypted push failed.");
        const [notice] = assignmentNotifications({ employeeId: "jordyn", appointmentId: "synthetic", title: "Studio A Rental", start: "2026-10-17T17:00:00Z", end: "2026-10-17T18:00:00Z" }, "accepted", ["owner"]);
        if (!notice.body.includes("1:00 PM–2:00 PM")) throw new Error("Incorrect studio time in Workerd.");
        const specific = await deliverPush("https://web.push.apple.com/specific", jwk, fetch, { keys, kind: "schedule", details: notice, notificationId: "synthetic-response" });
        if (!specific.accepted) throw new Error("Workerd specific push failed.");
      }};
    `);
    await writeFile(join(directory, "provider.mjs"), `
      export default { async fetch(request) {
        const url = new URL(request.url);
        if (url.hostname === "must-not-follow.invalid") throw new Error("Push followed a redirect.");
        if (url.pathname === "/encrypted" || url.pathname === "/specific") {
          const body = new Uint8Array(await request.arrayBuffer());
          if (body.length <= 86 || body[20] !== 65 || request.headers.get("Content-Encoding") !== "aes128gcm") throw new Error("Invalid encrypted push in Workerd.");
          if (url.pathname === "/encrypted" && (request.headers.get("Topic") !== "smooth-quiz" || request.headers.get("TTL") !== "300")) throw new Error("Incorrect quiz delivery options.");
          if (url.pathname === "/specific" && (!/^[A-Za-z0-9_-]{32}$/.test(request.headers.get("Topic")) || new TextDecoder().decode(body).includes("Jordyn"))) throw new Error("Invalid specific push in Workerd.");
          return new Response(null, { status: 201 });
        }
        if (request.method !== "POST" || await request.text() !== "" ||
            !/^vapid t=.+, k=.+$/.test(request.headers.get("Authorization") || "") ||
            request.headers.get("TTL") !== "86400" || request.headers.get("Urgency") !== "high") {
          throw new Error("Push request is missing authentication or delivery headers.");
        }
        return new Response("Synthetic provider response", {
          status: Number(url.pathname.slice(1)), headers: { Location: "https://must-not-follow.invalid/" }
        });
      }};
    `);
    const config = join(directory, "config.capnp");
    await writeFile(config, `
      using Workerd = import "/workerd/workerd.capnp";
      const config :Workerd.Config = (services = [
        (name = "main", worker = (
          compatibilityDate = "2026-05-15", globalOutbound = "provider",
          modules = [
            (name = "runner.mjs", esModule = embed "runner.mjs"),
            (name = "team-api/push.mjs", esModule = embed "push.mjs"),
            (name = "team-api/push-encryption.mjs", esModule = embed "encryption.mjs"),
            (name = "team-api/notification-content.mjs", esModule = embed "notification-content.mjs"),
            (name = "lib/team-schedule.mjs", esModule = embed "schedule.mjs"),
            (name = "lib/team-auth.mjs", esModule = embed "auth.mjs")
          ]
        )),
        (name = "provider", worker = (
          compatibilityDate = "2026-05-15", globalOutbound = "provider",
          modules = [(name = "provider.mjs", esModule = embed "provider.mjs")]
        ))
      ]);
    `);
    execFileSync(require.resolve("workerd/bin/workerd"), ["test", config], {
      encoding: "utf8", timeout: 20_000, stdio: "pipe",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
