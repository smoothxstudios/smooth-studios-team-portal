import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const values = process.argv.slice(2);
const get = (flag) => {
  const index = values.indexOf(flag);
  return index >= 0 && !values[index + 1]?.startsWith("--") ? values[index + 1] : undefined;
};
const eventId = get("--event");
const paid = get("--paid");
if (!eventId || !["true", "false", "clear"].includes(paid)) throw new Error("Use --event EVENT_ID --paid true|false|clear");
const overridePath = path.join(root, "data/payment-overrides.json");
const overrides = JSON.parse(await readFile(overridePath, "utf8"));
if (paid === "clear") delete overrides.events[eventId];
else overrides.events[eventId] = paid === "true";
await writeFile(overridePath, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
process.stdout.write(`${paid === "clear" ? "Cleared" : "Saved"} payment override for ${eventId}.\n`);
