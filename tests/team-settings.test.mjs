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

test("all nine employees are present in both scheduling and payroll", () => {
  assert.deepEqual(TEAM.filter(e => e.id !== "owner").map(e => e.id), config.employees.map(e => e.id));
  assert.equal(config.employees.length, 9);
});

test("private onboarding rejects legacy account changes, shared credentials, and invalid rates", () => {
  assert.throws(() => validateTeamSettings({ version: 1, employees: { owner: incoming.employees.dacari } }, config));
  assert.throws(() => validateTeamSettings({ version: 1, employees: { dacari: incoming.employees.dacari, amia: incoming.employees.dacari } }, config));
  assert.throws(() => validateTeamSettings({ version: 1, employees: { dacari: { ...incoming.employees.dacari, compensation: { type: "commission", rate: 20 } } } }, config));
  assert.throws(() => validateTeamSettings({ version: 1, employees: { dacari: { ...incoming.employees.dacari, password: "short" } } }, config));
  assert.equal(Object.keys(validateTeamSettings(incoming, config).employees).length, 6);
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
  assert.equal(before.length, 9);
});

test("multiple addresses resolve to one employee and reject aliases shared across people", () => {
  const aliased = structuredClone(incoming);
  aliased.employees.armani.email = "ARMANI@example.invalid, armani.alias@example.invalid, armani@example.invalid";
  for (const id of ["carlos", "armani"]) aliased.employees[id].compensation = { type: "commission", rate: 0.3 };
  const settings = validateTeamSettings(aliased, config);
  assert.equal(settings.employees.armani.email, "armani@example.invalid, armani.alias@example.invalid");
  const passwords = teamPasswords(config, settings, environment);
  const employees = resolveEmployees(config, settings, passwords, environment);
  const armani = employees.find(e => e.id === "armani");
  assert.equal(armani.email, "armani@example.invalid");
  assert.deepEqual(armani.invitationEmails, ["armani@example.invalid", "armani.alias@example.invalid"]);
  assert.equal(armani.accessReady, true);
  const event = { id: "aliased-rental", status: "confirmed", summary: "Fixture: Studio Rental",
    start: { dateTime: "2026-10-20T10:00:00-04:00" }, end: { dateTime: "2026-10-20T12:00:00-04:00" },
    description: "Price: $100.00\nPaid Online: $100.00",
    attendees: ["armani@example.invalid", "armani.alias@example.invalid", "carlos@example.invalid"].map(email => ({ email, responseStatus: "accepted" })) };
  const payloads = buildDashboardPayloads({ calendarEvents: [event], config: { ...config, employees }, ledger: { employees: {} }, overrides: {}, source: "sample" });
  assert.deepEqual(payloads.owner.rentals[0].assignedEmployeeIds, ["carlos", "armani"]);
  for (const id of ["carlos", "armani"]) {
    assert.equal(payloads[id].rentals.length, 1);
    assert.equal(payloads[id].rentals[0].employeePayouts[id].amountCents, 3000);
    assert.deepEqual(Object.keys(payloads[id].rentals[0].employeePayouts), [id]);
  }
  aliased.employees.carlos.email = "carlos@example.invalid, ARMANI.ALIAS@example.invalid";
  assert.throws(() => validateTeamSettings(aliased, config), /one team member/);
  assert.throws(() => resolveEmployees(config, settings, passwords, { ...environment, EMPLOYEE_EMAIL_AKIVA: "akiva@example.invalid, armani.alias@example.invalid" }), /one employee/);
  for (const email of ["", "valid@example.invalid, invalid", `${"a".repeat(250)}@example.invalid`, Array.from({ length: 11 }, (_, i) => `alias${i}@example.invalid`).join(", ")]) {
    assert.throws(() => validateTeamSettings({ version: 1, employees: { armani: { ...incoming.employees.armani, email } } }, config));
  }
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
    assert.equal(access.profiles.length, 10);
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
