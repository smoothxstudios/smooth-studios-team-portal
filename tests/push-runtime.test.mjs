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
    await writeFile(join(directory, "auth.mjs"), await readFile(new URL("../lib/team-auth.mjs", import.meta.url)));
    await writeFile(join(directory, "runner.mjs"), `
      import { deliverPush } from "./team-api/push.mjs";
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
      }};
    `);
    await writeFile(join(directory, "provider.mjs"), `
      export default { async fetch(request) {
        const url = new URL(request.url);
        if (url.hostname === "must-not-follow.invalid") throw new Error("Push followed a redirect.");
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
