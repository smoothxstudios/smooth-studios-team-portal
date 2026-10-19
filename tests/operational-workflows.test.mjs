import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { validatePaidThrough } from '../scripts/lib/employee-pay.mjs';

const workflow = name => yaml.load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
for (const name of ['mark-paid', 'override-payment', 'match-stripe-payment']) {
  test(`${name}: queued financial changes load latest main and treat inputs as data`, () => {
    const steps = Object.values(workflow(name).jobs)[0].steps;
    assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref, 'main');
    for (const step of steps.filter(step => step.run)) {
      assert.doesNotMatch(step.run, /\$\{\{\s*(?:inputs|github\.event\.inputs)\./);
    }
    const mutation = steps.find(step => Object.values(step.env ?? {}).some(value => /\$\{\{ inputs\./.test(value)));
    const directory = mkdtempSync(path.join(tmpdir(), 'studio-workflow-'));
    try {
      const marker = path.join(directory, 'injected');
      const hostile = `x" $(touch ${marker}) \`touch ${marker}\` ; echo injected`;
      const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE: path.join(directory, 'args.json') };
      for (const key of Object.keys(mutation.env)) if (/\$\{\{ inputs\./.test(mutation.env[key])) env[key] = hostile;
      const capture = `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\n`;
      for (const executable of ['npm', 'node']) writeFileSync(path.join(directory, executable), capture, { mode: 0o755 });
      const result = spawnSync('bash', ['-e', '-c', mutation.run], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(marker), false);
      const args = JSON.parse(readFileSync(env.CAPTURE, 'utf8'));
      assert.equal(args.filter(value => value === hostile).length, 2, 'each input stays one literal argument');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('paid-through rejects impossible dates and observes the studio day at UTC midnight', () => {
  const now = Date.parse('2026-10-20T01:00:00Z');
  for (const date of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '', undefined]) {
    assert.throws(() => validatePaidThrough(date, now), /valid YYYY-MM-DD/);
  }
  assert.equal(validatePaidThrough('2024-02-29', now), '2024-02-29');
  assert.equal(validatePaidThrough('2026-10-19', now), '2026-10-19');
  assert.throws(() => validatePaidThrough('2026-10-20', now), /future date/);
  assert.equal(validatePaidThrough('2026-10-20', now, 'UTC'), '2026-10-20');
});

test('payment override rejects missing flags before accessing its ledger', () => {
  const script = new URL('../scripts/set-payment-override.mjs', import.meta.url);
  const ledger = new URL('../data/payment-overrides.json', import.meta.url);
  const before = readFileSync(ledger, 'utf8');
  for (const args of [[], ['--paid', 'true'], ['--event', '--paid', 'true'], ['--event', 'synthetic']]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Use --event EVENT_ID/);
  }
  assert.equal(readFileSync(ledger, 'utf8'), before);
});
