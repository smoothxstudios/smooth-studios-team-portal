import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardDragStarted, dashboardDropPosition, moveDashboardSection } from '../lib/owner-layout-editor.mjs';

const sections = ['upcoming', 'attention', 'finances', 'hours', 'creative', 'reports'];

test('moving a Home section preserves every section, relative order and the saved source', () => {
  const saved = [...sections];
  assert.deepEqual(moveDashboardSection(saved, 'reports', 0), ['reports', ...sections.slice(0, -1)]);
  assert.deepEqual(moveDashboardSection(saved, 'upcoming', 5), [...sections.slice(1), 'upcoming']);
  assert.deepEqual(moveDashboardSection(saved, 'hours', 1), ['upcoming', 'hours', 'attention', 'finances', 'creative', 'reports']);
  assert.deepEqual(saved, sections);
  for (const section of sections) for (let position = -1; position <= 6; position++) {
    const next = moveDashboardSection(saved, section, position);
    assert.deepEqual([...next].sort(), [...saved].sort());
    assert.deepEqual(next.filter(id => id !== section), saved.filter(id => id !== section));
  }
});

test('keyboard boundaries and invalid moves leave the same draft untouched', () => {
  assert.equal(moveDashboardSection(sections, 'upcoming', -1), sections);
  assert.equal(moveDashboardSection(sections, 'reports', 8), sections);
  assert.equal(moveDashboardSection(sections, 'missing', 2), sections);
  assert.equal(moveDashboardSection(sections, 'hours', NaN), sections);
});

test('pointer threshold ignores taps and centers choose an unambiguous insertion point', () => {
  assert.equal(dashboardDragStarted(2, 5), false);
  assert.equal(dashboardDragStarted(0, 8), true);
  assert.equal(dashboardDragStarted(8, 0), true);
  assert.equal(dashboardDropPosition(25, [50, 110, 170]), 0);
  assert.equal(dashboardDropPosition(50, [50, 110, 170]), 0);
  assert.equal(dashboardDropPosition(111, [50, 110, 170]), 2);
  assert.equal(dashboardDropPosition(240, [50, 110, 170]), 3);
  assert.equal(dashboardDropPosition(50, []), 0);
});
