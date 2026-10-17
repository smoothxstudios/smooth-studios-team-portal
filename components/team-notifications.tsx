"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BellPlus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { createNotificationDraft } from "@/lib/team-notification-draft.mjs";
import { teamRequest } from "@/lib/team-api";
import { teamAccent } from "@/lib/dashboard-presentation";
import type { Employee } from "@/lib/dashboard-types";

type Destination = "alerts" | "settings" | "scheduling" | "creative";
type SentNotice = { id: string; recipientIds: string[]; title: string; body: string; target: Destination; createdAt: number };
type SendResult = { sent: boolean; recipientCount: number; notification: string };
const destinations: Record<Destination, string> = { alerts: "Inbox", settings: "Settings", scheduling: "Schedule", creative: "Creative work" };
const sentTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function TeamNotifications({ token, employees }: { token: string; employees: Employee[] }) {
  const people = employees.filter(person => person.id !== "owner");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [target, setTarget] = useState<Destination>("alerts");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [notices, setNotices] = useState<SentNotice[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const intent = useRef(createNotificationDraft()), operation = useRef(false), lifetime = useRef(0), historySequence = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const formId = useId(), titleCountId = useId(), bodyCountId = useId();

  const refreshHistory = useCallback(async () => {
    const id = ++historySequence.current;
    setHistoryLoading(true);
    try {
      const result = await teamRequest<{ notices: SentNotice[] }>(token, "/notifications/sent");
      if (id === historySequence.current) { setNotices(result.notices.slice(0, 20)); setHistoryError(""); }
      return true;
    } catch {
      if (id === historySequence.current) setHistoryError("Sent history couldn’t load. You can still send a notification.");
      return false;
    } finally { if (id === historySequence.current) setHistoryLoading(false); }
  }, [token]);
  useRefreshSource(refreshHistory, open);
  useEffect(() => { if (open) void refreshHistory(); }, [open, refreshHistory]);
  useEffect(() => () => { lifetime.current++; historySequence.current++; }, [token]);
  const edit = () => { setError(""); setMessage(""); };
  const send = async () => {
    if (operation.current) return;
    let draft;
    try { draft = intent.current.prepare({ recipientIds, title, body, target }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check the selected people and message."); return; }
    operation.current = true; setBusy(true); setError(""); setMessage(""); historySequence.current++;
    const current = lifetime.current;
    try {
      const result = await teamRequest<SendResult>(token, "/notifications", draft);
      if (current !== lifetime.current) return;
      if (!result.sent) throw new Error("The send was not confirmed.");
      setMessage(result.notification || `Notification saved for ${result.recipientCount} team member${result.recipientCount === 1 ? "" : "s"}.`);
      setNotices(previous => [{ ...draft, target: draft.target as Destination, createdAt: Date.now() }, ...previous.filter(notice => notice.id !== draft.id)].slice(0, 20));
      intent.current.clear(); setRecipientIds([]); setTitle(""); setBody(""); setTarget("alerts");
      void refreshHistory();
    } catch (cause) {
      if (current === lifetime.current) {
        const uncertain = !(cause instanceof Error) || cause instanceof TypeError || cause instanceof DOMException ||
          cause.message === "The send was not confirmed." || cause.message === "Team scheduling is not available yet. Please try again later.";
        setError(uncertain ? "Couldn’t confirm the send. Retry this unchanged draft to avoid sending it twice." : cause.message);
      }
    } finally { if (current === lifetime.current) { operation.current = false; setBusy(false); } }
  };

  return <>
    <div className="team-notifications-controls"><Button type="button" variant="outline" onClick={() => setOpen(true)}><BellPlus size={17} aria-hidden="true" />Send notification</Button></div>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="schedule-modal team-notifications-dialog" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}>
      <DialogHeader className="team-notifications-header"><div><DialogTitle ref={heading} tabIndex={-1}>Send notification</DialogTitle><DialogDescription>Choose who receives your message and where it opens.</DialogDescription></div><Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => setOpen(false)} aria-label="Close notification composer"><X size={20} aria-hidden="true" /></Button></DialogHeader>
      <div className="team-notifications-body">
        <form id={formId} onSubmit={event => { event.preventDefault(); void send(); }}>
          <fieldset className="team-notification-recipients" disabled={busy}><legend>Send to</legend><div className="team-notification-recipient-controls"><button type="button" onClick={() => { setRecipientIds(people.map(person => person.id)); edit(); }}>Select all</button><button type="button" disabled={!recipientIds.length} onClick={() => { setRecipientIds([]); edit(); }}>Clear</button><span>{recipientIds.length} selected</span></div>
            <div className="team-notification-person-list">{people.map(person => <label key={person.id}><input type="checkbox" checked={recipientIds.includes(person.id)} onChange={event => { setRecipientIds(previous => event.target.checked ? [...previous, person.id] : previous.filter(id => id !== person.id)); edit(); }} /><span className="employee-avatar" style={{ background: teamAccent(person.id, person.accent) }} aria-hidden="true">{person.name.slice(0, 1)}</span><span>{person.name}</span></label>)}</div>
          </fieldset>
          <label className="team-notification-field"><span>Title <small id={titleCountId}>{title.length}/80</small></span><Input required maxLength={80} disabled={busy} value={title} aria-describedby={titleCountId} onChange={event => { setTitle(event.target.value); edit(); }} /></label>
          <label className="team-notification-field"><span>Message <small id={bodyCountId}>{body.length}/360</small></span><Textarea required rows={3} maxLength={360} disabled={busy} value={body} aria-describedby={bodyCountId} onChange={event => { setBody(event.target.value); edit(); }} /></label>
          <label className="team-notification-field"><span>Open page</span><select value={target} disabled={busy} onChange={event => { setTarget(event.target.value as Destination); edit(); }}>{Object.entries(destinations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {message && <p className="team-notification-message" role="status">{message}</p>}{error && <p className="team-notification-error" role="alert">{error}</p>}
        </form>
        <details className="team-notifications-history"><summary>Last 20 sent</summary>{historyLoading && <p role="status">Updating history…</p>}{historyError && <p role="alert">{historyError} <button type="button" disabled={historyLoading} onClick={() => void refreshHistory()}>Try again</button></p>}{!historyLoading && !historyError && !notices.length && <p>No notifications sent yet.</p>}<ul>{notices.map(notice => <li key={notice.id}><strong>{notice.title}</strong><p>{notice.body}</p><span>{notice.recipientIds.map(id => people.find(person => person.id === id)?.name ?? "Team member").join(", ")}</span><small><time dateTime={new Date(notice.createdAt).toISOString()}>{sentTime.format(notice.createdAt)}</time> · {destinations[notice.target] ?? "Inbox"}</small></li>)}</ul></details>
      </div>
      <DialogFooter className="team-notifications-footer"><span>{recipientIds.length} recipient{recipientIds.length === 1 ? "" : "s"} · Opens {destinations[target]}</span><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button><Button type="submit" form={formId} disabled={busy || !recipientIds.length || !title.trim() || !body.trim()}><Send size={16} aria-hidden="true" />{busy ? "Sending…" : error ? "Retry send" : "Send notification"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
