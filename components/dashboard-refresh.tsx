"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Check, RefreshCw, WifiOff } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { createDashboardRefresh } from "@/lib/dashboard-refresh.mjs";
import { attachPullToRefresh, PULL_REFRESH_THRESHOLD } from "@/lib/pull-to-refresh.mjs";

const RefreshContext = createContext<ReturnType<typeof createDashboardRefresh> | null>(null);
export function DashboardRefreshProvider({ children }: { children: ReactNode }) {
  const coordinator = useMemo(() => createDashboardRefresh(), []);
  return <RefreshContext.Provider value={coordinator}>{children}</RefreshContext.Provider>;
}

/** Register an in-place read; returning false reports a partial refresh failure. */
export function useRefreshSource(read: () => Promise<unknown>, enabled = true) {
  const coordinator = useContext(RefreshContext);
  useEffect(() => {
    if (enabled && coordinator) return coordinator.register(read);
  }, [coordinator, enabled, read]);
}

type Phase = "idle" | "pulling" | "ready" | "refreshing" | "success" | "error";
export function PullToRefresh({ page, request, quietRequestId = 0 }: { page: string; request?: { id: number; arrival: Promise<boolean> } | null; quietRequestId?: number }) {
  const coordinator = useContext(RefreshContext);
  const slot = useRef<HTMLDivElement>(null);
  const { openMobile } = useSidebar();
  const blocked = useRef(openMobile);
  const startRefresh = useRef<(arrival?: Promise<boolean>) => void>(() => {});
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  useEffect(() => { blocked.current = openMobile; }, [openMobile]);
  useEffect(() => {
    const root = slot.current?.closest<HTMLElement>(".dashboard-main");
    if (!root || !coordinator) return;
    let disposed = false, busy = false, frame = 0, dismiss = 0;
    document.documentElement.classList.add("has-pull-refresh");
    const paint = (distance: number, pulling: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.dataset.pulling = String(pulling);
        root.style.setProperty("--refresh-distance", `${distance}px`);
        root.style.setProperty("--refresh-turn", `${distance * 4}deg`);
      });
    };
    const hide = () => { paint(0, false); setPhase("idle"); delete root.dataset.refreshMode; };
    const refresh = (arrival?: Promise<boolean>) => {
      if (disposed || busy) return;
      window.clearTimeout(dismiss);
      if (arrival) root.dataset.refreshMode = "toolbar";
      else delete root.dataset.refreshMode;
      busy = true; paint(arrival ? 0 : 52, false); setPhase("refreshing"); setError("");
      void (async () => {
        try {
          if (arrival && !await arrival) { if (!disposed) hide(); return; }
          if (disposed) return;
          await coordinator.run();
          if (!disposed) { setPhase("success"); dismiss = window.setTimeout(hide, 350); }
        } catch (cause: unknown) {
          if (!disposed) { paint(arrival ? 0 : 80, false); setError(cause instanceof Error ? cause.message : "Couldn’t refresh. Pull again to retry."); setPhase("error"); dismiss = window.setTimeout(hide, 3000); }
        } finally { busy = false; }
      })();
    };
    startRefresh.current = refresh;
    setPhase("idle");
    const detach = attachPullToRefresh(root, {
      isBusy: () => busy,
      isBlocked: () => blocked.current,
      onPull: distance => {
        if (disposed) return;
        delete root.dataset.refreshMode;
        window.clearTimeout(dismiss);
        paint(distance, distance > 0);
        setPhase(distance <= 0 ? "idle" : distance >= PULL_REFRESH_THRESHOLD ? "ready" : "pulling");
      },
      onRelease: refresh,
    });
    return () => {
      disposed = true; detach(); cancelAnimationFrame(frame); window.clearTimeout(dismiss);
      root.style.removeProperty("--refresh-distance"); root.style.removeProperty("--refresh-turn");
      delete root.dataset.pulling; delete root.dataset.refreshMode; document.documentElement.classList.remove("has-pull-refresh");
    };
  }, [coordinator, page]);
  useEffect(() => {
    if (request) startRefresh.current(request.arrival);
  }, [request]);
  useEffect(() => {
    if (!quietRequestId || !coordinator) return;
    // A different tab loads its mounted sources quietly. Reserve the visible
    // refresh treatment for tapping the active tab or pulling the page.
    const frame = requestAnimationFrame(() => {
      void coordinator.run().catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [coordinator, quietRequestId]);
  const Icon = phase === "success" ? Check : phase === "error" ? WifiOff : phase === "refreshing" ? RefreshCw : ArrowDown;
  const text = phase === "ready" ? "Release to refresh" : phase === "refreshing" ? "Refreshing…" : phase === "success" ? "Refreshed" : phase === "error" ? error : phase === "pulling" ? "Pull to refresh" : "";
  return <div ref={slot} className="pull-refresh-slot" data-phase={phase}>
    <div className="pull-refresh-indicator" role="status" aria-live="polite" aria-atomic="true">
      <Icon size={17} aria-hidden="true" /><span>{text}</span>
    </div>
  </div>;
}
