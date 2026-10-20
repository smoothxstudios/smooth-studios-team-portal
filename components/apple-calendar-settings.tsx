"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { teamRequest } from "@/lib/team-api";
import { TEAM_API_URL } from "@/lib/team-schedule.mjs";

type Subscription = { enabled: boolean; url?: string; subscribeUrl?: string };
function checkedSubscription(value: Subscription): Subscription {
  if (!value.enabled) return { enabled: false };
  const url = new URL(value.url ?? ""), expected = new URL(TEAM_API_URL);
  if (url.origin !== expected.origin || !/^\/calendar\/apple\/feed\/[A-Za-z0-9_-]{43}\.ics$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error("The calendar link could not be verified. Try again.");
  return { enabled: true, url: url.href, subscribeUrl: url.href.replace(/^https:/, "webcal:") };
}

export function AppleCalendarSettings({ token, isOwner, compact = false }: { token: string; isOwner: boolean; compact?: boolean }) {
  const [opened, setOpened] = useState(!compact), [subscription, setSubscription] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [confirmOff, setConfirmOff] = useState(false), [showLink, setShowLink] = useState(false);
  const lifetime = useRef(0), operation = useRef(false);
  const help = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const current = ++lifetime.current;
    setSubscription(null); setError(""); setMessage(""); setShowLink(false); setConfirmOff(false); setOpened(!compact);
    if (!compact) {
      operation.current = true; setBusy(true);
      void teamRequest<Subscription>(token, "/calendar/apple").then(result => {
        if (current === lifetime.current) setSubscription(checkedSubscription(result));
      }).catch(() => { if (current === lifetime.current) setError("Couldn’t check Apple Calendar. Try again."); })
        .finally(() => { if (current === lifetime.current) { operation.current = false; setBusy(false); } });
    }
    return () => { lifetime.current++; operation.current = false; };
  }, [token, compact]);

  const update = async (method: "GET" | "POST" | "DELETE") => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setMessage("");
    const current = lifetime.current;
    try {
      const result = checkedSubscription(await teamRequest<Subscription>(token, "/calendar/apple", method === "POST" ? {} : undefined, method));
      if (current !== lifetime.current) return;
      setSubscription(result); setOpened(true); setConfirmOff(false); setShowLink(false);
      if (method === "POST") setMessage("Your link is ready. Open Apple Calendar to finish subscribing.");
      if (method === "DELETE") setMessage("Sync turned off. Remove the old subscription from Apple Calendar too.");
    } catch (cause) { if (current === lifetime.current) { setOpened(true); setError(cause instanceof Error ? cause.message : "Couldn’t update Apple Calendar. Try again."); } }
    finally { if (current === lifetime.current) { operation.current = false; setBusy(false); } }
  };
  const copy = async () => {
    const current = lifetime.current;
    try { await navigator.clipboard.writeText(subscription!.url!); if (current === lifetime.current) setMessage("Link copied. In Apple Calendar, choose Calendars → Add Calendar → Add Subscription Calendar and paste it."); }
    catch { if (current === lifetime.current) { setShowLink(true); if (help.current) help.current.open = true; setMessage("Select and copy your subscription link below."); } }
  };

  return <section className={compact ? "apple-calendar compact" : "settings-card apple-calendar"} aria-label="Apple Calendar settings">
    {compact ? <Button type="button" variant="outline" disabled={busy} aria-expanded={opened} onClick={() => opened ? setOpened(false) : subscription?.enabled ? setOpened(true) : void update("POST")}><CalendarDays size={17} aria-hidden="true" />{busy ? "Preparing…" : "Apple Calendar"}</Button>
      : <div className="settings-card-heading"><CalendarDays size={23} aria-hidden="true" /><div><h2>Apple Calendar</h2><p>{isOwner ? "See studio appointments on your Apple devices." : "See your assigned appointments on your Apple devices."}</p></div></div>}
    {opened && <div className="apple-calendar-content">
      {compact && <p>{isOwner ? "Subscribe once to see all studio appointments." : "Subscribe once to see this appointment and your other assigned work."}</p>}
      {busy && !subscription && <p role="status">Preparing calendar…</p>}
      {subscription?.enabled && <>
        <div className="apple-calendar-actions"><a className="apple-calendar-open" href={subscription.subscribeUrl} referrerPolicy="no-referrer">Open Apple Calendar</a><Button type="button" variant="outline" disabled={busy} onClick={() => void copy()}><Copy size={16} aria-hidden="true" />Copy link</Button></div>
        <p className="schedule-small">Confirm Subscribe or Add in Apple Calendar. If already subscribed, you’re set. The dashboard can’t verify that final step.</p>
        <details ref={help} className="apple-calendar-help"><summary>Setup help &amp; options</summary>
          <p>If the button doesn’t open Calendar, copy the link. In Apple Calendar, choose Calendars → Add Calendar → Add Subscription Calendar, paste it, and confirm. On Mac, use File → New Calendar Subscription.</p>
          <p>Choose iCloud when offered to see the subscription on your other Apple devices. If your Google calendar already shows these appointments in Apple Calendar, use that calendar to avoid duplicates.</p>
          <p>This private link gives read-only access to {isOwner ? "studio appointments" : "your assigned work"}. Keep it to yourself.</p>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setShowLink(value => !value)}>Show subscription link</Button>
          {showLink && <input className="apple-calendar-url" aria-label="Private Apple Calendar subscription link" readOnly value={subscription.url} onFocus={event => event.target.select()} />}
          {!confirmOff ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmOff(true)}>Turn off Apple Calendar sync</Button> : <div className="apple-calendar-confirm" role="group" aria-label="Turn off Apple Calendar sync"><p>Stop updates to this subscription? You can set up a new link later.</p><div className="apple-calendar-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmOff(false)}>Keep sync</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => void update("DELETE")}>{busy ? "Turning off…" : "Turn off sync"}</Button></div></div>}
        </details>
        {showLink && <p className="sr-only">Your private subscription link is shown under Setup help &amp; options.</p>}
      </>}
      {subscription && !subscription.enabled && <Button type="button" variant="outline" disabled={busy} onClick={() => void update("POST")}>{busy ? "Preparing…" : "Set up Apple Calendar"}</Button>}
      <p className="schedule-small">Changes and cancellations update when Apple refreshes this read-only calendar. Updates may be delayed. Accept or decline assignments in the dashboard.</p>
      {message && <p role="status" className="calendar-settings-message">{message}</p>}
      {error && <div role="alert"><p>{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => void update("GET")}>Try again</Button></div>}
    </div>}
  </section>;
}
