"use client";

import { useSyncExternalStore } from "react";
import { applyDashboardTheme, readDashboardTheme } from "@/lib/dashboard-theme.mjs";

const themeEvent = "smooth-theme-change";
const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = () => false;

function subscribe(onChange: () => void) {
  // Also initializes appearance if the pre-paint script was unavailable.
  applyDashboardTheme(readDashboardTheme());
  window.addEventListener(themeEvent, onChange);
  return () => window.removeEventListener(themeEvent, onChange);
}

function setDark(dark: boolean) {
  const theme = dark ? "dark" : "light";
  applyDashboardTheme(theme);
  try { localStorage.setItem("smooth-theme", theme); } catch { /* Still works for this session. */ }
  window.dispatchEvent(new Event(themeEvent));
}

export function useDashboardTheme() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [dark, setDark] as const;
}
