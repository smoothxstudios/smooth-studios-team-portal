import { readFile } from "node:fs/promises";
import { teamToken } from "../lib/team-auth.mjs";
import { TEAM_API_URL } from "../lib/team-schedule.mjs";

let envelope;
try { envelope = JSON.parse(await readFile(new URL("../data/studio-reference-import.json", import.meta.url), "utf8")); }
catch (error) { if (error.code === "ENOENT") process.exit(0); throw error; }
if (!process.env.DASHBOARD_PASSWORD_OWNER) throw new Error("The owner secret is required to import studio information.");
const response = await fetch(`${TEAM_API_URL}/sync/studio-reference`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
  headers: { "content-type": "application/json", authorization: `Bearer ${await teamToken(process.env.DASHBOARD_PASSWORD_OWNER, "sync")}` }, body: JSON.stringify(envelope) });
if (!response.ok) throw new Error(`Studio reference import failed (${response.status}). Existing information was preserved.`);
const result = await response.json();
process.stdout.write(result.alreadyImported ? "Studio reference already imported; current owner edits preserved.\n" : `Studio reference imported: ${result.entries} information cards and ${result.checklistItems} checklist items.\n`);
