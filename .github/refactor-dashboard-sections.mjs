import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const main = 'components/smooth-dashboard.tsx';
const original = fs.readFileSync(main, 'utf8');
const blob = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex');
assert.equal(blob, '1a4a79eba397b40a2403fe19b644a52c6e186bff', 'Dashboard changed since inspection; stop rather than overwrite another edit.');
const groups = {
  'lib/dashboard-presentation.ts': ['FALLBACK_PROFILES', 'TEAM_ACCENTS', 'STUDIO_TIME_ZONE', 'MONEY', 'MONEY_EXACT', 'ViewKey', 'RentalState', 'CustomerPaymentState', 'AppointmentStatus', 'PaymentFilter', 'dollars', 'teamAccent', 'formatDate', 'formatTime', 'durationLabel', 'customerPaymentState', 'paidEarnings', 'unpaidEarnings', 'rentalState', 'eligibleForPayout', 'appointmentStatus', 'appointmentCategory', 'normalizedMatchText', 'stripeAppointmentScore'],
  'components/dashboard/navigation.tsx': ['NavigationGroup', 'NavigationItem', 'NAV_ITEMS', 'EMPLOYEE_NAV_ITEMS', 'DashboardNavigation', 'MobileMenuButton', 'SettingsNavigation', 'CloseMobileMenu'],
  'components/dashboard/shared.tsx': ['Logo', 'EmptyState', 'ChartTooltip'],
  'components/dashboard/login-screen.tsx': ['LoginScreen'],
  'components/dashboard/financial-summary.tsx': ['OwnerFinancialSummary', 'PeriodTotals', 'CategoryRevenue'],
  'components/dashboard/stripe-money-flow.tsx': ['StripeMoneyFlow'],
  'components/dashboard/owner-overview.tsx': ['OwnerAttention', 'OwnerUpcoming'],
  'components/dashboard/rental-table.tsx': ['EmployeeEarnings', 'CategoryBadge', 'StatusBadge', 'PaymentAmount', 'RentalTable'],
  'components/dashboard/team-page.tsx': ['TeamPage'],
  'components/dashboard/payout-page.tsx': ['PayoutPage'],
  'components/dashboard/payment-forms.tsx': ['PaymentOverrideForm', 'StripeMatchForm'],
};
const source = ts.createSourceFile(main, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nameOf = node => ts.isVariableStatement(node)
  ? node.declarationList.declarations.length === 1 && ts.isIdentifier(node.declarationList.declarations[0].name) ? node.declarationList.declarations[0].name.text : null
  : node.name && ts.isIdentifier(node.name) ? node.name.text : null;
const definitions = new Map(source.statements.map(node => [nameOf(node), node]).filter(([name]) => name));
const destination = new Map();
for (const [file, names] of Object.entries(groups)) for (const name of names) {
  assert.ok(definitions.has(name), `Missing inspected declaration ${name}`);
  assert.ok(!destination.has(name), `Duplicate destination for ${name}`);
  destination.set(name, file);
}
const imports = source.statements.filter(ts.isImportDeclaration).map(node => node.getText(source)).join('\n');
const declarations = source.statements.filter(node => !ts.isImportDeclaration(node) && !(ts.isExpressionStatement(node) && node.expression.text === 'use client'));
const moduleImport = file => '@/' + file.replace(/\.tsx?$/, '');
const movedImports = ownFile => Object.entries(groups).filter(([file]) => file !== ownFile).flatMap(([file, names]) => {
  const types = names.filter(name => ts.isTypeAliasDeclaration(definitions.get(name)) || ts.isInterfaceDeclaration(definitions.get(name)));
  const values = names.filter(name => !types.includes(name));
  return [values.length && `import { ${values.join(', ')} } from ${JSON.stringify(moduleImport(file))};`, types.length && `import type { ${types.join(', ')} } from ${JSON.stringify(moduleImport(file))};`].filter(Boolean);
}).join('\n');
const exported = node => 'export ' + node.getText(source);
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
for (const [file] of Object.entries(groups)) {
  assert.ok(!fs.existsSync(file), `Refusing to replace an existing module: ${file}`);
  const selected = declarations.filter(node => destination.get(nameOf(node)) === file);
  write(file, `${file.endsWith('.tsx') ? '"use client";\n\n' : ''}${imports}\n${movedImports(file)}\n\n${selected.map(exported).join('\n\n')}\n`);
}
const remaining = declarations.filter(node => !destination.has(nameOf(node)));
write(main, `"use client";\n\n${imports}\n${movedImports(main)}\n\n${remaining.map(node => node.getText(source)).join('\n\n')}\n`);
// This temporary module gives verification tests the exact pre-refactor bodies.
const before = '.github/dashboard-before.tsx';
write(before, `"use client";\n\n${imports}\n\n${declarations.filter(node => destination.has(nameOf(node))).map(exported).join('\n\n')}\n`);

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert.ok(!config.error, 'Cannot load TypeScript settings');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const files = [main, ...Object.keys(groups), before].map(file => path.resolve(file));
const versions = new Map(files.map(file => [file, 0]));
const host = {
  getScriptFileNames: () => [...new Set([...parsed.fileNames, ...files])],
  getScriptVersion: file => String(versions.get(file) ?? 0),
  getScriptSnapshot: file => fs.existsSync(file) ? ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8')) : undefined,
  getCurrentDirectory: () => root,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host);
for (const file of files) {
  const edits = service.organizeImports({ type: 'file', fileName: file }, {}, { preferTypeOnlyAutoImports: true });
  for (const edit of edits) {
    let content = fs.readFileSync(edit.fileName, 'utf8');
    for (const change of [...edit.textChanges].sort((a, b) => b.span.start - a.span.start)) content = content.slice(0, change.span.start) + change.newText + content.slice(change.span.start + change.span.length);
    fs.writeFileSync(edit.fileName, content);
    versions.set(edit.fileName, (versions.get(edit.fileName) ?? 0) + 1);
  }
}
service.dispose();
// Import cleanup must not change any component, helper, type, or state body.
const unexport = text => text.replace(/^export\s+/, '');
for (const [file, names] of Object.entries(groups)) {
  const moved = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Map(moved.statements.map(node => [nameOf(node), node]).filter(([name]) => name));
  for (const name of names) assert.equal(unexport(found.get(name).getText(moved)), definitions.get(name).getText(source), `Behavior changed while moving ${name}`);
}
const after = ts.createSourceFile(main, fs.readFileSync(main, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
for (const node of remaining) {
  const name = nameOf(node);
  if (name) assert.equal(after.statements.find(item => nameOf(item) === name)?.getText(after), node.getText(source), `Orchestration changed: ${name}`);
}
const releaseFile = 'config/dashboard-releases.json';
const releases = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
assert.equal(releases.currentVersion, '2.24.3', 'Unexpected concurrent app version');
releases.currentVersion = '2.24.4';
releases.releases.unshift({
  id: '2026-10-17-dashboard-section-refactor', version: '2.24.4', date: '2026-10-17', category: 'Maintenance',
  title: 'Dashboard sections separated for safer maintenance',
  changes: [
    'Separated navigation, sign-in, financial summaries, appointments, team cards, payouts, and payment forms into focused modules while retaining their existing screens and behavior.',
    'Shared formatting and display-status helpers now live in one place; authentication, scheduling recovery, payment calculations, and live data integrations retain their existing behavior.',
    'Added component rendering and shared-helper regression tests alongside the existing scheduling tests.'
  ], commits: [],
});
write(releaseFile, JSON.stringify(releases, null, 2) + '\n');
for (const file of ['package.json', 'package-lock.json']) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(value.version, '2.24.3'); value.version = '2.24.4';
  if (value.packages) { assert.equal(value.packages[''].version, '2.24.3'); value.packages[''].version = '2.24.4'; }
  write(file, JSON.stringify(value, null, 2) + '\n');
}
const boundaries = Object.entries(groups).map(([file, names]) => ({ file, declarations: names.length, lines: fs.readFileSync(file, 'utf8').trimEnd().split('\n').length }));
console.log(JSON.stringify({ declarationsMoved: destination.size, originalLines: original.trimEnd().split('\n').length, remainingLines: fs.readFileSync(main, 'utf8').trimEnd().split('\n').length, modules: boundaries }, null, 2));
for (const file of fs.readdirSync('tests').filter(file => file.endsWith('.test.mjs'))) {
  if (fs.readFileSync(path.join('tests', file), 'utf8').includes('smooth-dashboard.tsx')) console.log(`Source-dependent test to review: tests/${file}`);
}
