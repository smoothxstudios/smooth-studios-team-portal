"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { teamRequest } from "@/lib/team-api";
import { useRefreshSource } from "@/components/dashboard-refresh";

export type DashboardAlert = {
  id: string; sequence: number; kind: string; title: string; body: string;
  target: "scheduling" | "availability" | "creative" | "quiz"; targetId: string | null;
  personId?: string | null;
  createdAt: number; expiresAt: number | null; readAt: number | null;
};
type InboxPage = { alerts: DashboardAlert[]; unreadCount: number; throughSequence: number; nextCursor: number | null };
type Summary = Pick<InboxPage, "unreadCount" | "throughSequence">;
const empty: InboxPage = { alerts: [], unreadCount: 0, throughSequence: 0, nextCursor: null };

export function useAlerts(token: string, active: boolean) {
  const [page, setPage] = useState<InboxPage>(empty);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [deletion, setDeletion] = useState<{ alert: DashboardAlert } | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(0), operation = useRef(false), pages = useRef(1);
  const refresh = useCallback(async () => {
    if (operation.current) return false;
    const current = ++requestId.current;
    try {
      if (!active) {
        const result = await teamRequest<Summary>(token, "/alerts?summary=1");
        if (current === requestId.current) { setPage(previous => ({ ...previous, unreadCount: result.unreadCount })); setError(""); }
      } else {
        let result = await teamRequest<InboxPage>(token, `/alerts?filter=${filter}`);
        // Preserve the number of loaded pages during background refreshes.
        for (let index = 1; index < pages.current && result.nextCursor && current === requestId.current; index++) {
          const next = await teamRequest<InboxPage>(token, `/alerts?filter=${filter}&before=${result.nextCursor}`);
          result = { ...result, alerts: [...result.alerts, ...next.alerts], nextCursor: next.nextCursor };
        }
        if (current === requestId.current) { setPage(result); setError(""); }
      }
      return true;
    } catch (error) { if (current === requestId.current) setError(error instanceof Error ? error.message : "Alerts couldn’t be loaded. Try again."); return false; }
    finally { if (current === requestId.current) setLoading(false); }
  }, [token, active, filter]);
  useRefreshSource(refresh);
  useEffect(() => {
    const start = window.setTimeout(() => void refresh(), 0);
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    return () => { ++requestId.current; window.clearTimeout(start); window.clearInterval(interval); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  const chooseFilter = (next: "all" | "unread") => {
    if (next === filter || operation.current) return;
    ++requestId.current; pages.current = 1; setPage(previous => ({ ...previous, alerts: [], nextCursor: null })); setLoading(true); setFilter(next);
  };
  const loadMore = async () => {
    if (operation.current || !page.nextCursor) return;
    operation.current = true; const current = ++requestId.current; setBusy(true);
    try {
      const result = await teamRequest<InboxPage>(token, `/alerts?filter=${filter}&before=${page.nextCursor}`);
      if (current === requestId.current) {
        setPage(previous => ({ ...previous, nextCursor: result.nextCursor, alerts: [...previous.alerts, ...result.alerts.filter(item => !previous.alerts.some(old => old.id === item.id))] }));
        pages.current++; setError("");
      }
    } catch (error) { if (current === requestId.current) setError(error instanceof Error ? error.message : "More alerts couldn’t be loaded."); }
    finally { operation.current = false; setBusy(false); }
  };
  const markRead = async (alert?: DashboardAlert) => {
    if (operation.current) return false;
    if (alert?.readAt) return true;
    operation.current = true; const current = ++requestId.current; setBusy(true);
    try {
      const result = await teamRequest<{ unreadCount: number; readAt: number }>(token, alert ? "/alerts/read" : "/alerts/read-all",
        alert ? { ids: [alert.id] } : { throughSequence: page.throughSequence }, "PATCH");
      if (current === requestId.current) {
        setPage(previous => ({ ...previous, unreadCount: result.unreadCount,
          alerts: previous.alerts.map(item => (!alert ? item.sequence <= page.throughSequence : item.id === alert.id) && !item.readAt ? { ...item, readAt: result.readAt } : item).filter(item => filter !== "unread" || !item.readAt) }));
        setError("");
      }
      return current === requestId.current;
    } catch (error) { if (current === requestId.current) setError(error instanceof Error ? error.message : "Couldn’t mark this alert as read."); return false; }
    finally { operation.current = false; setBusy(false); setLoading(false); }
  };
  const deleteAlert = async (alert: DashboardAlert) => {
    if (operation.current) return false;
    operation.current = true; const current = ++requestId.current; setBusy(true);
    try {
      const result = await teamRequest<{ unreadCount: number; deletedAt: number }>(token, "/alerts", { ids: [alert.id] }, "DELETE");
      if (current === requestId.current) {
        setPage(previous => ({ ...previous, unreadCount: result.unreadCount, alerts: previous.alerts.filter(item => item.id !== alert.id) }));
        setDeletion({ alert }); setError("");
      }
      return current === requestId.current;
    } catch (error) { if (current === requestId.current) setError(error instanceof Error ? error.message : "This alert couldn’t be deleted. Try again."); return false; }
    finally { operation.current = false; setBusy(false); setLoading(false); }
  };
  const undoDelete = async () => {
    if (!deletion || operation.current) return false;
    operation.current = true; const current = ++requestId.current; setBusy(true);
    let restored = false;
    try {
      const result = await teamRequest<Summary>(token, "/alerts/restore", { ids: [deletion.alert.id] }, "PATCH");
      if (current === requestId.current) {
        setPage(previous => ({ ...previous, unreadCount: result.unreadCount }));
        setDeletion(null); setError(""); restored = true;
      }
    } catch (error) { if (current === requestId.current) setError(error instanceof Error ? error.message : "This alert couldn’t be restored. Try again."); }
    finally { operation.current = false; }
    // Re-read the current filter and loaded pages so another device's read state
    // and any arrivals during deletion stay authoritative after Undo.
    if (restored) await refresh();
    setBusy(false); setLoading(false);
    return restored;
  };
  return { ...page, loading, busy, error, filter, deletion, chooseFilter, refresh, loadMore, markRead, deleteAlert, undoDelete };
}
export type AlertsState = ReturnType<typeof useAlerts>;
