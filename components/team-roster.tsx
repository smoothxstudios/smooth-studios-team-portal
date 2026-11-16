"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { teamRequest } from "@/lib/team-api";
import { useRefreshSource } from "@/components/dashboard-refresh";
type Member = { id: string; active: boolean; revision: number };
type Roster = { members: Member[]; loading: boolean; busy: boolean; error: string; refresh: () => Promise<boolean>; setActive: (id: string, active: boolean) => Promise<void>; visible: (id: string) => boolean; isActive: (id: string) => boolean; includeInactive: boolean; setIncludeInactive: (value: boolean) => void };
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
    } catch { if (sequence.current === id) setError("Team visibility couldn’t load. Reload before changing a status."); return false; }
    finally { if (sequence.current === id) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => { void refresh(); const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(update, 30_000); window.addEventListener("focus", update);
    return () => { sequence.current++; window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refresh]);
  const setActive = async (id: string, active: boolean) => {
    if (saving.current) return;
    saving.current = true; sequence.current++; setBusy(true); setError("");
    try { const current = members.find(member => member.id === id);
      if (!current) throw new Error("Reload the team before changing this status.");
      const saved = await teamRequest<Member>(token, "/team-roster", { id, active, revision: current.revision }, "PUT");
      setMembers(previous => previous.map(member => member.id === id ? saved : member));
      window.dispatchEvent(new Event("smooth-roster-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Status couldn’t be saved."); }
    finally { saving.current = false; setBusy(false); }
  };
  const isActive = (id: string) => members.find(member => member.id === id)?.active !== false;
  return <Context.Provider value={{ members, loading, busy, error, refresh, setActive, isActive, visible: id => includeInactive || isActive(id), includeInactive, setIncludeInactive }}>{children}</Context.Provider>;
}
export function IncludeInactive() {
  const roster = useTeamRoster();
  const id = useId();
  return roster ? <div className="roster-filter"><Switch id={id} size="sm" checked={roster.includeInactive} onCheckedChange={roster.setIncludeInactive} /><label htmlFor={id}>Include Inactive</label></div> : null;
}
