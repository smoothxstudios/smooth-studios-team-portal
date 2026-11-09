/** Read appearance without writing over a saved choice during startup. */
export function readDashboardTheme(browser = window) {
  try {
    const saved = browser.localStorage.getItem("smooth-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* Device appearance remains available when storage is blocked. */ }
  return browser.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** @param {"dark" | "light"} theme */
export function applyDashboardTheme(theme, doc = document) {
  const dark = theme === "dark";
  const background = dark ? "#000000" : "#f2f2f7";
  doc.documentElement.classList.toggle("dark", dark);
  doc.documentElement.style.colorScheme = theme;
  doc.documentElement.style.backgroundColor = background;
  for (const [name, content] of [
    ["theme-color", background],
    ["apple-mobile-web-app-status-bar-style", dark ? "black" : "default"],
  ]) {
    let meta = doc.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = doc.createElement("meta");
      meta.setAttribute("name", name);
      doc.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
  }
}

// The same functions run before the first page content and after a user toggle.
// Keep them self-contained so the bootstrap cannot drift from the live control.
export const dashboardThemeScript = `(${applyDashboardTheme.toString()})((${readDashboardTheme.toString()})(window),document);`;
