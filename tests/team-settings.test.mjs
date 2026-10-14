import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateTeamSettings, resolveEmployees, teamPasswords } from "../scripts/lib/team-settings.mjs";
import { buildDashboardPayloads, decryptPayload, writeEncryptedDashboards } from "../scripts/lib/dashboard-data.mjs";
import { TEAM } from "../lib/team-schedule.mjs";

const config = JSON.parse(await readFile(new URL("../config/studio.config.json", import.meta.url), "utf8"));
const environment = Object.fromEntries(["owner", "akiva", "jordyn", "rayne"].flatMap(id => [[`DASHBOARD_PASSWORD_${id.toUpperCase()}`, `fixture-long-password-${id}`], [`EMPLOYEE_EMAIL_${id.toUpperCase()}`, `${id}@example.invalid`]]));
const incoming = { version: 1, employees: Object.fromEntries(config.employees.filter(e => e.onboarding).map(e => [e.id, { email: `${e.id}@example.invalid`, password: `fixture-new-long-password-${e.id}`, compensation: { type: "pending" } }])) };

test("all seven employees are present in both scheduling and payroll", () => {
  assert.deepEqual(TEAM.filter(e => e.id !== "owner").map(e => e.id), config.employees.map(e => e.id));
  assert.equal(config.employees.length, 7);
});

test("private onboarding rejects legacy account changes, shared credentials, and invalid rates", () => {
  assert.throws(() => validateTeamSettings({ version: 1, employees: { owner: incoming.employees.dacari } }, config));
  assert.throws(() => validateTeamSettings({ version: 1, employees: { dacari: incoming.employees.dacari, amia: incoming.employees.dacari } }, config));
  assert.throws(() => validateTeamSettings({ version: 1, employees: { dacari: { ...incoming.employees.dacari, compensation: { type: "commission", rate: 20 } } } }, config));
  assert.throws(() => validateTeamSettings({ version: 1, employees: { dacari: { ...incoming.employees.dacari, password: "short" } } }, config));
  assert.equal(Object.keys(validateTeamSettings(incoming, config).employees).length, 4);
});

test("new account setup preserves original logins and rejects duplicate invitation emails", () => {
  const settings = validateTeamSettings(incoming, config);
  const passwords = teamPasswords(config, settings, environment);
  assert.equal(passwords.jordyn, environment.DASHBOARD_PASSWORD_JORDYN);
  assert.equal(passwords.dacari, incoming.employees.dacari.password);
  const employees = resolveEmployees(config, settings, passwords, environment);
  assert.equal(employees.find(e => e.id === "dacari").accessReady, true);
  assert.throws(() => resolveEmployees(config, { version: 1, employees: { dacari: { ...incoming.employees.dacari, email: "AKIVA@example.invalid" } } }, passwords, environment));
  const before = resolveEmployees(config, { version: 1, employees: {} }, teamPasswords(config, { version: 1, employees: {} }, environment), environment);
  assert.equal(before.find(e => e.id === "dacari").accessReady, false);
  assert.equal(before.length, 7);
});

test("activation publishes separately encrypted accounts without leaking private settings", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "studio-onboarding-test-"));
  try {
    const settings = validateTeamSettings(incoming, config);
    const passwords = teamPasswords(config, settings, environment);
    const configured = { ...config, employees: resolveEmployees(config, settings, passwords, environment) };
    const payloads = buildDashboardPayloads({ calendarEvents: [], config: configured, ledger: { employees: {} }, overrides: {}, source: "sample" });
    payloads.owner.teamAccess = { dacari: { password: passwords.dacari } };
    await writeEncryptedDashboards({ payloads, passwords, config: configured, outputDirectory: output });
    const access = JSON.parse(await readFile(path.join(output, "access.json"), "utf8"));
    assert.equal(access.profiles.length, 8);
    assert.equal(JSON.stringify(access).includes("example.invalid"), false);
    const envelope = JSON.parse(await readFile(path.join(output, "dacari.json"), "utf8"));
    assert.equal(JSON.stringify(envelope).includes(passwords.dacari), false);
    const own = decryptPayload(envelope, passwords.dacari);
    assert.deepEqual(own.employees.map(e => e.id), ["dacari"]);
    assert.equal(own.teamAccess, undefined);
    assert.equal(own.workflowAccess, undefined);
    assert.throws(() => decryptPayload(envelope, passwords.amia));
  } finally { await rm(output, { recursive: true, force: true }); }
});
