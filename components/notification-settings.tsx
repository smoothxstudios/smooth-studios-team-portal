"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enableTeamPush, disableTeamPush, teamPushIsEnabled, testTeamPush, teamRequest, PushPermissionError, type TeamSchedule } from "@/lib/team-api";
import { TEAM } from "@/lib/team-schedule.mjs";

export function NotificationSettings({ token, isOwner, schedule: suppliedSchedule }: { token: string; isOwner: boolean; schedule?: TeamSchedule }) {
  const [schedule, setSchedule] = useState<TeamSchedule | null>(suppliedSchedule ?? null);
  const [supported, setSupported] = useState(false), [enabled, setEnabled] = useState(false);
  const [appleMobile, setAppleMobile] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; blocked?: boolean } | null>(null);
  const refresh = useCallback(async () => {
    const next = suppliedSchedule ?? await teamRequest<TeamSchedule>(token, "/schedule");
    setSchedule(next);
    setEnabled(await teamPushIsEnabled(token, next.pushPublicKey));
  }, [token, suppliedSchedule]);
  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    // Device-specific wording only; push support is still detected by capability.
    setAppleMobile(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
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
    setBusy(true); setFeedback(null);
    try {
      // Keep the permission request directly in the tap handler, before network I/O.
      const permission = kind === "enable" && supported ? Notification.requestPermission() : null;
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
    } catch (error) {
      const blocked = kind === "enable" && ((error instanceof PushPermissionError && error.permission === "denied") || (error instanceof Error && error.name === "NotAllowedError") || ("Notification" in window && Notification.permission === "denied"));
      setFeedback({ ok: false, text: blocked ? "Notifications were not allowed." : error instanceof Error ? error.message : "Notification setup failed. Check your connection and try again.", blocked });
    }
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
    {feedback && <div className={`${feedback.ok ? "schedule-success" : "schedule-warning"} notification-feedback`} role={feedback.ok ? "status" : "alert"}>
      <p>{feedback.text}</p>
      {feedback.blocked && <>
        {appleMobile ? <ol>
          <li>Open your phone’s Settings → Notifications → Smooth Studios and turn on Allow Notifications.</li>
          <li>If the app is missing or still blocked, delete the Smooth Studios Home Screen app and re-add it: open dashboard.smoothstudios.co in Safari → Share → Add to Home Screen. Keep Open as Web App on if shown.</li>
          <li>Open the new icon, sign in, and return to Settings → Preferences → Notifications. Tap Enable on this device → Allow, then Send test.</li>
        </ol> : <ol>
          <li>Open this website’s permissions in your browser settings and change Notifications to Allow. Check your device’s notification settings for the browser too.</li>
          <li>Reload the dashboard, return to Settings → Preferences → Notifications, then choose Enable on this device and Send test.</li>
        </ol>}
        <p className="notification-help-hint">Find the full steps in Settings → Help by searching “notifications not allowed”.</p>
      </>}
    </div>}
    {isOwner && schedule && <p className="schedule-small">Registered devices: {TEAM.map(person => `${person.name} ${schedule.devices[person.id] ?? 0}`).join(" · ")}. Focus mode and device settings can suppress alerts.</p>}
  </details>;
}
