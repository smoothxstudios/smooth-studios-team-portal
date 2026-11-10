"use client";
import { useEffect, useState } from "react";

/** Refresh time-sensitive labels while visible, including after returning to the app. */
export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return now;
}
