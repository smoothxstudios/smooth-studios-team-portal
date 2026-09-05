import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = Object.fromEntries(
  process.argv.slice(2).reduce((entries, value, index, values) => {
    if (value.startsWith("--") && values[index + 1] && !values[index + 1].startsWith("--")) {
      entries.push([value.slice(2), values[index + 1]]);
    }
    return entries;
  }, []),
);

const chargeKey = argumentsByName.charge?.trim();
const eventKey = argumentsByName.event?.trim();
if (!chargeKey || !/^[a-f0-9]{64}$/.test(chargeKey)) throw new Error("A valid Stripe payment key is required");
if (!eventKey || !/^[a-f0-9]{64}$/.test(eventKey)) throw new Error("A valid Calendar appointment key is required");

const matchesPath = path.join(root, "data/stripe-payment-matches.json");
const matches = JSON.parse(await readFile(matchesPath, "utf8"));
matches.version = 1;
matches.charges ??= {};
matches.charges[chargeKey] = eventKey;
await writeFile(matchesPath, `${JSON.stringify(matches, null, 2)}\n`, "utf8");
process.stdout.write(`Saved Stripe payment match for ${chargeKey.slice(-8)}.\n`);
