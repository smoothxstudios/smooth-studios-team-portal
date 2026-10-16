/**
 * @typedef {{ id: string, date: string, title: string, category: string,
 *   changes: string[], version?: string, retrospective?: boolean, commits?: string[],
 *   employee?: { title?: string, category?: string, changes: string[] } }} ReleaseNote
 */

/**
 * Select presentation copy before searching, filtering, or counting it.
 * Only explicitly curated employee copy enters the team view. These are public
 * product notes, never a place for secrets or private business records.
 * @param {ReleaseNote[]} releases
 * @param {"owner" | "employee" | "signed-out"} viewer
 * @returns {ReleaseNote[]}
 */
export function releaseHistoryForViewer(releases, viewer) {
  if (viewer === "owner") return releases.map(release => ({ ...release, changes: [...release.changes] }));
  if (viewer !== "employee") return [];
  return releases.flatMap(release => {
    if (!release.employee?.changes.length) return [];
    return [{ id: release.id, date: release.date, version: release.version, retrospective: release.retrospective,
      title: release.employee.title ?? release.title,
      category: release.employee.category ?? release.category,
      changes: [...release.employee.changes] }];
  });
}

/** Combine already-visible, filtered notes into one daily entry.
 * Original release records remain intact for version history and searching.
 * @param {ReleaseNote[]} releases
 * @returns {{ date: string, versions: string[], retrospective: boolean,
 *   sections: { category: string, changes: string[] }[] }[]}
 */
export function groupReleaseDays(releases) {
  const days = new Map();
  for (const release of [...releases].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!days.has(release.date)) days.set(release.date, { date: release.date, versions: [], retrospective: false, sections: [] });
    const day = days.get(release.date);
    if (release.version && !day.versions.includes(release.version)) day.versions.push(release.version);
    day.retrospective ||= Boolean(release.retrospective);
    let section = day.sections.find(section => section.category === release.category);
    if (!section) { section = { category: release.category, changes: [] }; day.sections.push(section); }
    for (const change of release.changes) if (!section.changes.includes(change)) section.changes.push(change);
  }
  return [...days.values()];
}
