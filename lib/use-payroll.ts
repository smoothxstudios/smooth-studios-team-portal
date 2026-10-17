"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { teamRequest } from "@/lib/team-api";
import type { PayrollState } from "@/lib/dashboard-types";
import { useRefreshSource } from "@/components/dashboard-refresh";

export function usePayroll(token: string, initial?: PayrollState) {
  const [state, setState] = useState(initial), [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await teamRequest<PayrollState>(token, "/payroll");
      if (current === sequence.current) { setState(next); setError(""); }
      return true;
    } catch { if (current === sequence.current) setError("Advance balances could not refresh. Showing the last synced balances."); return false; }
  }, [token]);
  useRefreshSource(refresh);
  const updateReviewSummary = useCallback((reviews: { employeeId: string }[]) => {
    // The review read is newer than an in-flight summary. Only update the
    // notice; balances and allocations remain the authoritative payroll data.
    sequence.current++;
    setState(previous => previous ? { ...previous, reviewCount: reviews.length,
      reviewPeople: [...new Set(reviews.map(item => item.employeeId))].map(employeeId => ({ employeeId, count: reviews.filter(item => item.employeeId === employeeId).length })),
    } : previous);
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update); window.addEventListener("smooth-payroll-updated", update);
    return () => { sequence.current++; window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("smooth-payroll-updated", update); };
  }, [refresh]);
  return { state, error, refresh, updateReviewSummary };
}
