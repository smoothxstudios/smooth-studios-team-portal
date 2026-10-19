"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { teamRequest } from "@/lib/team-api";
import { useRefreshSource } from "@/components/dashboard-refresh";

export type CreativeAssignment = {
  entryType?: "manual"; workCategory?: "onboarding" | "training" | "other"; earnedAt?: string;
  id: string; employeeId: string; version: number; title: string; instructions: string; references: string[];
  dueAt: string; amountCents: number; status: "offered" | "accepted" | "submitted" | "revision" | "approved" | "declined" | "cancelled";
  advanceAppliedCents?: number;
  createdAt: string; updatedAt: string; approvedAt: string | null;
  submissions: { id: string; submittedAt: string; links: string[]; note: string }[];
  payments: { id: string; amountCents: number; paidAt: string; method: string }[];
  history: { id: string; event: string; by: string; at: string; note?: string }[];
};
export type CreativeWorkState = ReturnType<typeof useCreativeWork>;

export function useCreativeWork(token: string) {
  const [items, setItems] = useState<CreativeAssignment[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const result = await teamRequest<{ assignments: CreativeAssignment[] }>(token, "/creative-work");
      if (current === requestId.current) { setItems(result.assignments); setError(""); setLoaded(true); }
      return true;
    } catch (error) { if (current === requestId.current) setError(error instanceof Error ? error.message : "Creative work couldn’t be loaded."); return false; }
    finally { if (current === requestId.current) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const invalidate = () => { requestId.current++; };
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    return () => { invalidate(); window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  const mutate = async (input: Record<string, unknown>, item?: CreativeAssignment, manual = false) => {
    requestId.current++;
    try {
      const result = await teamRequest<{ assignment: CreativeAssignment }>(token, item ? `/creative-work/${item.id}` : manual ? "/creative-work/manual-pay" : "/creative-work", item ? { ...input, version: item.version } : input, item ? "PATCH" : "POST");
      requestId.current++;
      setItems(previous => [result.assignment, ...previous.filter(entry => entry.id !== result.assignment.id)]);
      setError(""); setLoading(false); setLoaded(true);
      window.dispatchEvent(new Event("smooth-payroll-updated"));
      return result.assignment;
    } catch (error) { await refresh(); throw error; }
  };
  const addPay = (input: Record<string, unknown>) => mutate(input, undefined, true);
  return { items, loading, loaded, error, refresh, mutate, addPay };
}
