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
