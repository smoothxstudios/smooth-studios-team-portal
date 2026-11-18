"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SwitchRow } from "@/components/ui/switch";
import { teamRequest } from "@/lib/team-api";
import { useRefreshSource } from "@/components/dashboard-refresh";
type Member = { id: string; active: boolean; revision: number; rentalDeductionStart?: string | null };
type Roster = { members: Member[]; loading: boolean; busy: boolean; error: string; refresh: () => Promise<boolean>; setActive: (id: string, active: boolean) => Promise<void>; setRentalDeductionStart: (id: string, start: string | null) => Promise<boolean>; visible: (id: string) => boolean; isActive: (id: string) => boolean; includeInactive: boolean; setIncludeInactive: (value: boolean) => void };
const Context = createContext<Roster | null>(null);
export const useTeamRoster = () => useContext(Context);
export function TeamRosterProvider({ token, children }: { token: string; children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [includeInactive, setIncludeInactive] = useState(false);
  const sequence = useRef(0), saving = useRef(false);
  const refresh = useCallback(async () => {
    if (saving.current) return false;
    const id = ++sequence.current;
    try { const result = await teamRequest<{ members: Member[] }>(token, "/team-roster");
      if (sequence.current !== id) return false;
      setMembers(result.members); setError(""); return true;
    } catch { if (sequence.current === id) setError("Team settings couldn’t load. Reload before making changes."); return false; }
    finally { if (sequence.current === id) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => { void refresh(); const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(update, 30_000); window.addEventListener("focus", update);
    return () => { sequence.current++; window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refresh]);
  const saveMember = async (id: string, change: { active?: boolean; rentalDeductionStart?: string | null }) => {
    if (saving.current) return false;
    saving.current = true; sequence.current++; setBusy(true); setError("");
    try { const current = members.find(member => member.id === id);
      if (!current) throw new Error("Reload the team before changing these settings.");
      const saved = await teamRequest<Member>(token, "/team-roster", { id, ...change, revision: current.revision }, "PUT");
      setMembers(previous => previous.map(member => member.id === id ? saved : member));
      window.dispatchEvent(new Event("smooth-roster-updated"));
      if (Object.hasOwn(change, "rentalDeductionStart")) window.dispatchEvent(new Event("smooth-payroll-updated"));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings couldn’t be saved."); return false; }
    finally { saving.current = false; setBusy(false); }
  };
  const setActive = async (id: string, active: boolean) => { await saveMember(id, { active }); };
  const setRentalDeductionStart = (id: string, start: string | null) => saveMember(id, { rentalDeductionStart: start });
  const isActive = (id: string) => members.find(member => member.id === id)?.active !== false;
  return <Context.Provider value={{ members, loading, busy, error, refresh, setActive, setRentalDeductionStart, isActive, visible: id => includeInactive || isActive(id), includeInactive, setIncludeInactive }}>{children}</Context.Provider>;
}
export function IncludeInactive() {
  const roster = useTeamRoster();
  return roster ? <SwitchRow className="roster-filter" checked={roster.includeInactive} onCheckedChange={roster.setIncludeInactive}>Include Inactive</SwitchRow> : null;
}
