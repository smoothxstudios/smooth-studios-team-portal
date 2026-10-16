"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enableTeamPush, disableTeamPush, teamPushIsEnabled, testTeamPush, teamRequest, type TeamSchedule } from "@/lib/team-api";
import { TEAM } from "@/lib/team-schedule.mjs";

export function NotificationSettings({ token, isOwner, schedule: suppliedSchedule }: { token: string; isOwner: boolean; schedule?: TeamSchedule }) {
  const [schedule, setSchedule] = useState<TeamSchedule | null>(suppliedSchedule ?? null);
  const [supported, setSupported] = useState(false), [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = useCallback(async () => {
    const next = suppliedSchedule ?? await teamRequest<TeamSchedule>(token, "/schedule");
    setSchedule(next);
    setEnabled(await teamPushIsEnabled(token, next.pushPublicKey));
  }, [token, suppliedSchedule]);
  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    const check = async () => {
      try { await refresh(); }
      catch { setFeedback({ ok: false, text: "Couldn’t verify notifications on this device. Check your connection and try again." }); }
      finally { setLoading(false); }
    };
    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [refresh]);
  async function action(kind: "enable" | "disable" | "test") {
    if (busy) return;
    // Keep the permission request directly in the tap handler, before network I/O.
    const permission = kind === "enable" && supported ? Notification.requestPermission() : null;
    setBusy(true); setFeedback(null);
    try {
      if (kind === "enable") {
        if (!schedule?.pushPublicKey || !permission) throw new Error("Open this dashboard from your Home Screen to enable iPhone notifications.");
        await enableTeamPush(token, schedule.pushPublicKey, await permission);
        setEnabled(true); setFeedback({ ok: true, text: "Notifications enabled on this device. Use Send test to check delivery." });
      } else if (kind === "disable") {
        await disableTeamPush(token); setEnabled(false);
        setFeedback({ ok: true, text: "Notifications disabled on this device." });
      } else {
        const result = await testTeamPush(token, schedule?.pushPublicKey ?? null);
        if (result.expired) setEnabled(false);
        setFeedback({ ok: result.accepted, text: result.message });
      }
    } catch (error) { setFeedback({ ok: false, text: error instanceof Error ? error.message : "Notification setup failed." }); }
    finally { setBusy(false); }
  }
  return <details className="schedule-panel schedule-push" open={!isOwner}>
    <summary className="notification-summary"><span><Bell size={18} />Notifications</span><small>{loading ? "Checking this device…" : enabled ? "On for this device" : "Set up alerts"}</small></summary>
    <div><p>{isOwner ? "Receive schedule changes and employee responses." : "Get alerts for rental and task offers, and when your next Daily Quiz question is ready."}</p>
      <p className="schedule-small">On iPhone: Safari → Share → Add to Home Screen. Open that icon, sign in, then enable notifications. Alerts stay on when you close the app. Logging out disables them on this device.</p>
      {!loading && !supported && <p className="schedule-warning">This browser session does not support push. Use the Home Screen app on iPhone or a supported browser.</p>}
    </div>
    <div className="schedule-actions">{enabled ? <><Button variant="outline" disabled={busy || loading} onClick={() => void action("test")}>Send test</Button><Button variant="outline" disabled={busy || loading} onClick={() => void action("disable")}>Disable this device</Button></> : <Button disabled={busy || loading || !supported || !schedule?.pushPublicKey} onClick={() => void action("enable")}><Bell size={16} />Enable on this device</Button>}
      {!schedule && !loading && <Button variant="outline" disabled={busy} onClick={() => { setLoading(true); void refresh().then(() => setFeedback(null)).catch(() => setFeedback({ ok: false, text: "Notification settings couldn’t load. Check your connection and try again." })).finally(() => setLoading(false)); }}>Try again</Button>}
    </div>
    {feedback && <p className={feedback.ok ? "schedule-success" : "schedule-warning"} role={feedback.ok ? "status" : "alert"}>{feedback.text}</p>}
    {isOwner && schedule && <p className="schedule-small">Registered devices: {TEAM.map(person => `${person.name} ${schedule.devices[person.id] ?? 0}`).join(" · ")}. Focus mode and device settings can suppress alerts.</p>}
  </details>;
}
