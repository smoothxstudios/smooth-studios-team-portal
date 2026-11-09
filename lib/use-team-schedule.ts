"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { attachQuietSnapshotRefresh, dashboardHasOpenEditor } from "@/lib/dashboard-refresh.mjs";
import { hapticFeedback } from "@/lib/haptics.mjs";
import { applyConfirmedScheduleMutation, readScheduleSnapshot } from "@/lib/schedule-snapshot.mjs";
import { teamPushIsEnabled, teamRequest, type TeamAssignment, type TeamSchedule } from "@/lib/team-api";
import { saveScheduleMutation, scheduleMutationError, scheduleMutationMessage } from "@/lib/team-schedule-mutations.mjs";

/** Scheduling I/O stays separate from view filters and editor drafts. */
export function useTeamSchedule({ token, userId, isOwner, availabilityOnly }: {
  token: string; userId: string; isOwner: boolean; availabilityOnly: boolean;
}) {
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const session = useRef({ active: false, token, hasSnapshot: false });
  const requestVersion = useRef(0);
  const mutationInFlight = useRef(false);
  const reminderIds = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!session.current.active || session.current.token !== token) return false;
    const version = ++requestVersion.current;
    return readScheduleSnapshot({
      read: () => teamRequest<TeamSchedule>(token, "/schedule"),
      canApply: () => session.current.active && session.current.token === token && version === requestVersion.current,
      onSnapshot: (result: TeamSchedule) => { session.current.hasSnapshot = true; setSchedule(result); setNeedsRefresh(false); },
    });
  }, [token]);

  useEffect(() => {
    let disposed = false;
    session.current = { active: true, token, hasSnapshot: session.current.token === token && session.current.hasSnapshot };
    const currentSession = session.current;
    const requests = requestVersion;
    async function refresh() {
      const canRefresh = () => !disposed && !mutationInFlight.current && (!session.current.hasSnapshot || !dashboardHasOpenEditor());
      if (!canRefresh()) return;
      const version = ++requestVersion.current;
      const canApply = () => version === requestVersion.current && canRefresh();
      try {
        const activation = await fetch("./data/team-api.json", { cache: "no-store" });
        const ready = activation.ok && (await activation.json()).enabled === true;
        if (!canApply()) return;
        setEnabled(ready);
        if (ready) {
          await readScheduleSnapshot({
            read: () => teamRequest<TeamSchedule>(token, "/schedule"), canApply,
            onSnapshot: (result: TeamSchedule) => {
              session.current.hasSnapshot = true;
              setSchedule(result); setError(""); setNeedsRefresh(false);
              // Settings owns connection/setup feedback; never block a schedule read.
              if (!availabilityOnly) void teamPushIsEnabled(token, result.pushPublicKey).catch(() => {});
            },
          });
        }
      } catch {
        if (canApply() && !session.current.hasSnapshot) setError("Couldn’t refresh scheduling. Check your connection and try again; the last view may be out of date.");
      } finally { if (!disposed) setLoading(false); }
    }
    void refresh();
    const detach = attachQuietSnapshotRefresh(refresh, { intervalMs: 60_000 });
    return () => { disposed = true; currentSession.active = false; ++requests.current; detach(); };
  }, [token, availabilityOnly]);

  async function mutate(path: string, data: object, method = "POST") {
    if ((!session.current.active || session.current.token !== token) || !schedule || busy || needsRefresh || mutationInFlight.current) return false;
    mutationInFlight.current = true;
    ++requestVersion.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await saveScheduleMutation({
        path, method, data, revision: schedule.revision, userId, isOwner,
        write: (revision: number) => teamRequest<{ notification?: string; removedAssignment?: TeamAssignment }>(token, path, { ...data, revision }, method),
        refresh: () => teamRequest<TeamSchedule>(token, "/schedule"),
        onRefresh: (fresh: TeamSchedule) => { if (session.current.active && session.current.token === token) { setSchedule(fresh); setNeedsRefresh(false); } },
      });
      if (!session.current.active || session.current.token !== token) return false;
      setNeedsRefresh(true);
      setSchedule(current => applyConfirmedScheduleMutation(current, path, data, result));
      // Once saved, a refresh failure must not invite a duplicate submission.
      setMessage(scheduleMutationMessage(path, data, method, result));
      hapticFeedback("success");
      try { await load(); } catch { if (session.current.active && session.current.token === token) setError("Your change was saved, but the updated view could not load. Try again to load the latest view before making another change."); }
      return true;
    } catch (e) { if (session.current.active && session.current.token === token) { setError(scheduleMutationError(path, e)); hapticFeedback("warning"); } return false; }
    finally { mutationInFlight.current = false; if (session.current.active && session.current.token === token) setBusy(false); }
  }

  async function remindAssignment(item: TeamAssignment) {
    if ((!session.current.active || session.current.token !== token) || !isOwner || busy || mutationInFlight.current) return;
    mutationInFlight.current = true; ++requestVersion.current; setBusy(true); setError(""); setMessage("");
    const id = reminderIds.current.get(item.id) ?? crypto.randomUUID();
    reminderIds.current.set(item.id, id);
    try {
      const result = await teamRequest<{ notification: string }>(token, `/assignments/${item.id}/remind`, { id });
      if (!session.current.active || session.current.token !== token) return;
      reminderIds.current.delete(item.id);
      setMessage(result.notification);
    } catch (error) {
      if (!session.current.active || session.current.token !== token) return;
      setError(error instanceof Error ? error.message : "The reminder could not be confirmed. Try again.");
      try { await load(); } catch { /* Keep the last schedule while preserving the retry ID. */ }
    } finally { mutationInFlight.current = false; if (session.current.active && session.current.token === token) setBusy(false); }
  }

  const refreshManually = useCallback(async () => {
    if ((!session.current.active || session.current.token !== token) || mutationInFlight.current) return false;
    mutationInFlight.current = true; setBusy(true); setError("");
    try { const applied = await load(); if (applied) setEnabled(true); return applied; }
    catch (e) { if (session.current.active && session.current.token === token) setError(e instanceof Error ? e.message : "Refresh failed."); return false; }
    finally { mutationInFlight.current = false; if (session.current.active && session.current.token === token) setBusy(false); }
  }, [load, token]);
  return { schedule, loading, enabled, error, setError, message, busy, needsRefresh, mutate, remindAssignment, refreshManually };
}
