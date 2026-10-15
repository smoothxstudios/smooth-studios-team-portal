import { readFileSync } from "node:fs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const manifest = read("../config/dashboard-releases.json");
const pkg = read("../package.json");
const lock = read("../package-lock.json");
const current = manifest.releases[0];

if (![pkg.version, lock.version, lock.packages[""].version, current?.version].every(version => version === manifest.currentVersion)) {
  throw new Error("Dashboard release version must match package.json, package-lock.json, and the newest release note.");
}
const ids = new Set();
for (const [index, release] of manifest.releases.entries()) {
  if (ids.has(release.id) || !release.id || !release.title || !release.category || !/^\d{4}-\d{2}-\d{2}$/.test(release.date) || !release.changes?.length) {
    throw new Error(`Incomplete or duplicate dashboard release: ${release.id}`);
  }
  if (index && manifest.releases[index - 1].date < release.date) throw new Error("Dashboard release notes must be newest first.");
  ids.add(release.id);
}
console.log(`Dashboard v${manifest.currentVersion}: ${manifest.releases.length} dated updates verified.`);
