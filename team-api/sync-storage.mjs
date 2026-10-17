export function trackImport(db, kind, generation) {
  return db.prepare('INSERT OR IGNORE INTO sync_imports(kind, generation, created_at) VALUES (?, ?, ?)')
    .bind(kind, generation, Date.now()).run();
}

// An interrupted upload never becomes visible. Reclaim its staging rows only
// after the 24-hour commit window, and never delete the active generation.
export async function cleanImports(db, kind) {
  const [table, state] = kind === 'calendar' ? ['team_appointments', 'team_state'] : ['payroll_rental_earnings', 'payroll_state'];
  await db.batch([
    db.prepare(`DELETE FROM ${table} WHERE generation IN (SELECT generation FROM sync_imports WHERE kind = ? AND created_at < ?)
      AND generation != (SELECT generation FROM ${state} WHERE id = 1)`).bind(kind, Date.now() - 86400_000),
    db.prepare('DELETE FROM sync_imports WHERE kind = ? AND created_at < ?').bind(kind, Date.now() - 86400_000),
  ]);
}
