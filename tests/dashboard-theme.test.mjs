import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { applyDashboardTheme, dashboardThemeScript, readDashboardTheme } from "../lib/dashboard-theme.mjs";

function environment({ saved = null, deviceDark = false, blocked = false, existingMeta = true } = {}) {
  let writes = 0;
  const metas = new Map();
  const root = { dark: false, style: {}, classList: { toggle: (_name, value) => { root.dark = value; } } };
  const createMeta = () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
  if (existingMeta) for (const name of ["theme-color", "apple-mobile-web-app-status-bar-style"]) {
    const meta = createMeta(); meta.setAttribute("name", name); metas.set(name, meta);
  }
  const document = {
    documentElement: root,
    querySelector: selector => metas.get(selector.match(/name="([^"]+)"/)[1]) ?? null,
    createElement: createMeta,
    head: { appendChild: meta => metas.set(meta.attributes.name, meta) },
  };
  const window = {
    localStorage: { getItem() { if (blocked) throw Error("Storage denied"); return saved; }, setItem() { writes++; } },
    matchMedia: () => ({ matches: deviceDark }),
  };
  return { window, document, root, metas, writes: () => writes };
}

test("saved light and dark choices override the device without being rewritten at startup", () => {
  for (const saved of ["light", "dark"]) {
    const env = environment({ saved, deviceDark: saved !== "dark" });
    vm.runInNewContext(dashboardThemeScript, env);
    assert.equal(env.root.dark, saved === "dark");
    assert.equal(env.root.style.colorScheme, saved);
    assert.equal(env.writes(), 0);
  }
});

test("first visit, invalid preferences, and blocked storage use device appearance", () => {
  for (const deviceDark of [false, true]) for (const options of [{}, { saved: "invalid" }, { blocked: true }]) {
    const env = environment({ ...options, deviceDark });
    assert.equal(readDashboardTheme(env.window), deviceDark ? "dark" : "light");
    vm.runInNewContext(dashboardThemeScript, env);
    assert.equal(env.root.dark, deviceDark);
  }
});

test("theme changes update root, browser tint, and standalone status-bar metadata together", () => {
  for (const existingMeta of [true, false]) {
    const env = environment({ existingMeta });
    for (const theme of ["dark", "light", "dark"]) {
      applyDashboardTheme(theme, env.document);
      const color = theme === "dark" ? "#000000" : "#f2f2f7";
      assert.equal(env.root.style.backgroundColor, color);
      assert.equal(env.root.style.colorScheme, theme);
      assert.equal(env.metas.get("theme-color").attributes.content, color);
      assert.equal(env.metas.get("apple-mobile-web-app-status-bar-style").attributes.content, theme === "dark" ? "black" : "default");
      assert.equal(env.metas.size, 2);
    }
  }
});
