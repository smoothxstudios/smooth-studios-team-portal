"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BellPlus, CalendarCheck, CalendarClock, Link2, MessageSquare, Pencil, RefreshCw, Send, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { createNotificationDraft } from "@/lib/team-notification-draft.mjs";
import { NOTIFICATION_PRESETS, createRentalReminderIntent, notificationPresetMessage, notificationRentalChoices, sameRentalReminder } from "@/lib/notification-presets.mjs";
import { teamRequest, type TeamSchedule } from "@/lib/team-api";
import { teamAccent } from "@/lib/dashboard-presentation";
import { notificationTime } from "@/team-api/notification-content.mjs";
import type { Employee } from "@/lib/dashboard-types";

type Destination = "alerts" | "settings" | "scheduling" | "creative" | "availability";
type Preset = "rental-response" | "upcoming-rental" | "availability" | "calendar" | "refresh" | "custom";
type Content = { title: string; body: string; target: Destination };
type Rental = ReturnType<typeof notificationRentalChoices>["bookings"][number];
type RentalOffer = ReturnType<typeof notificationRentalChoices>["responses"][number];
type SentNotice = { id: string; recipientIds: string[]; title: string; body: string; target: Destination; createdAt: number };
type SendResult = { sent: boolean; recipientCount: number; notification: string };
const destinations: Record<Destination, string> = { alerts: "Inbox", settings: "Settings", scheduling: "Schedule", creative: "Creative work", availability: "Availability" };
const presetIcons = { "rental-response": CalendarCheck, "upcoming-rental": CalendarClock, availability: SlidersHorizontal, calendar: Link2, refresh: RefreshCw, custom: MessageSquare };
const emptyContent: Content = { title: "", body: "", target: "alerts" };
const sentTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function TeamNotifications({ token, employees }: { token: string; employees: Employee[] }) {
  const people = employees.filter(person => person.id !== "owner");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [preset, setPreset] = useState<Preset | null>(null);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [custom, setCustom] = useState<Content>(emptyContent), [edited, setEdited] = useState<Content | null>(null);
  const [rental, setRental] = useState<Rental | null>(null), [offer, setOffer] = useState<RentalOffer | null>(null);
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null), [scheduleLoading, setScheduleLoading] = useState(false), [scheduleError, setScheduleError] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [notices, setNotices] = useState<SentNotice[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const intent = useRef(createNotificationDraft()), responseIntent = useRef(createRentalReminderIntent());
  const operation = useRef(false), lifetime = useRef(0), historySequence = useRef(0), scheduleSequence = useRef(0);
  const uncertainAttempt = useRef<{ key: string; path: string; data: object } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const formId = useId(), titleCountId = useId(), bodyCountId = useId();
  const choices = useMemo(() => notificationRentalChoices(schedule, Date.now()), [schedule]);
  const rentalMode = preset === "rental-response" || preset === "upcoming-rental";
  const selected = preset === "rental-response" ? offer : rental;
  const currentSelection = preset === "rental-response" ? choices.responses.find(item => item.id === offer?.id) : choices.bookings.find(item => item.id === rental?.id);
  const staleRental = rentalMode && selected && !sameRentalReminder(selected, currentSelection);
  const generated = notificationPresetMessage(preset, selected) as Content | null;
  const content = preset === "custom" ? custom : edited ?? generated;
  const effectiveRecipients = preset === "rental-response" ? offer?.recipientIds ?? [] : recipientIds;
  const selectablePeople = preset === "upcoming-rental" ? people.filter(person => rental?.recipientIds.includes(person.id)) : people;
  const key = JSON.stringify({ preset, selection: selected, recipientIds: [...effectiveRecipients].sort(), content });
  const retryUncertain = uncertainAttempt.current?.key === key;
  const invalidRentalRecipients = preset === "upcoming-rental" && recipientIds.some(id => !rental?.recipientIds.includes(id));

  const refreshHistory = useCallback(async () => {
    const id = ++historySequence.current; setHistoryLoading(true);
    try {
      const result = await teamRequest<{ notices: SentNotice[] }>(token, "/notifications/sent");
      if (id === historySequence.current) { setNotices(result.notices.slice(0, 20)); setHistoryError(""); }
      return true;
    } catch { if (id === historySequence.current) setHistoryError("Sent history couldn’t load. You can still send a reminder."); return false; }
    finally { if (id === historySequence.current) setHistoryLoading(false); }
  }, [token]);
  const refreshSchedule = useCallback(async (): Promise<TeamSchedule | false> => {
    const id = ++scheduleSequence.current; setScheduleLoading(true);
    try {
      const result = await teamRequest<TeamSchedule>(token, "/schedule");
      if (id !== scheduleSequence.current) return false;
      setSchedule(result); setScheduleError(""); return result;
    } catch { if (id === scheduleSequence.current) setScheduleError("Rentals couldn’t load. Other reminders and Custom message are still available."); return false; }
    finally { if (id === scheduleSequence.current) setScheduleLoading(false); }
  }, [token]);
  useRefreshSource(refreshHistory, open);
  useRefreshSource(refreshSchedule, open);
  useEffect(() => { if (open) { void refreshHistory(); void refreshSchedule(); } }, [open, refreshHistory, refreshSchedule]);
  useEffect(() => {
    operation.current = false; setBusy(false);
    return () => { lifetime.current++; historySequence.current++; scheduleSequence.current++; };
  }, [token]);
  const edit = () => { setError(""); setMessage(""); uncertainAttempt.current = null; };
  const choosePreset = (next: Preset) => { setPreset(next); setEdited(null); edit(); };
  const chooseRental = (next: Rental) => { setRental(next); setRecipientIds(next.recipientIds); setEdited(null); edit(); };
  const chooseOffer = (next: RentalOffer) => { setOffer(next); setEdited(null); edit(); };
  const setContent = (values: Partial<Content>) => {
    if (preset === "custom") setCustom(previous => ({ ...previous, ...values }));
    else setEdited(previous => ({ ...(previous ?? content ?? emptyContent), ...values }));
    edit();
  };
  const send = async () => {
    if (operation.current || !preset || !content) return;
    let path: string, data: object;
    try {
      if (retryUncertain && uncertainAttempt.current) ({ path, data } = uncertainAttempt.current);
      else if (preset === "rental-response") {
        if (!offer) throw new Error("Choose a rental offer.");
        path = `/assignments/${offer.id}/remind`; data = { id: responseIntent.current.prepare(offer.id, offer).id };
      } else {
        if (preset === "upcoming-rental" && (!rental || invalidRentalRecipients)) throw new Error("Choose the rental’s confirmed team members.");
        path = "/notifications";
        data = intent.current.prepare({ recipientIds: effectiveRecipients, ...content,
          ...(preset === "upcoming-rental" && rental ? { context: { type: "rental", appointmentId: rental.id, start: rental.start, end: rental.end } } : {}) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the selected people and reminder."); return; }
    operation.current = true; setBusy(true); setError(""); setMessage(""); historySequence.current++;
    const current = lifetime.current;
    let submitted = false;
    try {
      if (rentalMode && !retryUncertain) {
        const latest = await refreshSchedule();
        if (current !== lifetime.current) return;
        if (!latest) throw new Error("Couldn’t check the current rental. Try loading rentals again before sending.");
        const fresh = notificationRentalChoices(latest, Date.now());
        const next = preset === "rental-response" ? fresh.responses.find(item => item.id === offer?.id) : fresh.bookings.find(item => item.id === rental?.id);
        if (!sameRentalReminder(selected, next)) throw new Error("This rental or its team changed. Review the latest details before sending.");
      }
      submitted = true;
      const result = await teamRequest<SendResult>(token, path, data);
      if (current !== lifetime.current) return;
      if (!result.sent) throw new Error("The send was not confirmed.");
      setMessage(result.notification || `Reminder saved for ${result.recipientCount} team member${result.recipientCount === 1 ? "" : "s"}.`);
      intent.current.clear(); responseIntent.current.clear(); uncertainAttempt.current = null;
      if (preset === "custom") setCustom(emptyContent);
      setPreset(null); setEdited(null); setRecipientIds([]); setRental(null); setOffer(null);
      void refreshHistory();
    } catch (cause) {
      if (current === lifetime.current) {
        const uncertain = submitted && (!(cause instanceof Error) || cause instanceof TypeError || cause instanceof DOMException ||
          cause.message === "The send was not confirmed." || cause.message === "Team scheduling is not available yet. Please try again later.");
        uncertainAttempt.current = uncertain ? { key, path, data } : null;
        setError(uncertain ? "Couldn’t confirm the send. Retry this unchanged reminder to avoid sending it twice." : cause instanceof Error ? cause.message : "Couldn’t send the reminder.");
      }
    } finally { if (current === lifetime.current) { operation.current = false; setBusy(false); } }
  };
  const canSend = Boolean(preset && content?.title.trim() && content.body.trim() && effectiveRecipients.length &&
    (!rentalMode || selected) && (!staleRental || retryUncertain) && !invalidRentalRecipients);

  return <>
    <div className="team-notifications-controls"><Button type="button" variant="outline" onClick={() => setOpen(true)}><BellPlus size={17} aria-hidden="true" />Send reminder</Button></div>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="schedule-modal team-notifications-dialog" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}>
      <DialogHeader className="team-notifications-header"><div><DialogTitle ref={heading} tabIndex={-1}>Send reminder</DialogTitle><DialogDescription>Choose a studio rental or a team task.</DialogDescription></div><Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => setOpen(false)} aria-label="Close reminder composer"><X size={20} aria-hidden="true" /></Button></DialogHeader>
      <div className="team-notifications-body"><form id={formId} onSubmit={event => { event.preventDefault(); void send(); }}>
        <div className="team-notification-presets" role="group" aria-label="Reminder type">{NOTIFICATION_PRESETS.map(option => { const id = option.id as Preset, Icon = presetIcons[id]; return <button key={id} type="button" disabled={busy} aria-pressed={preset === id} onClick={() => choosePreset(id)}><Icon size={17} aria-hidden="true" /><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>; })}</div>
        {rentalMode && <div className="team-notification-rental-picker">
          {scheduleLoading && <p className="schedule-small" role="status">Updating rentals…</p>}{scheduleError && <p className="schedule-small" role="alert">{scheduleError}</p>}
          <label className="team-notification-field"><span>{preset === "rental-response" ? "Pending rental offer" : "Studio rental"}</span><select disabled={busy || !schedule} value={selected?.id ?? ""} onChange={event => { if (preset === "rental-response") { const next = choices.responses.find(item => item.id === event.target.value); if (next) chooseOffer(next); } else { const next = choices.bookings.find(item => item.id === event.target.value); if (next) chooseRental(next); } }}><option value="">Choose a rental{preset === "rental-response" ? " offer" : ""}</option>{preset === "rental-response" ? choices.responses.map(item => <option key={item.id} value={item.id}>{people.find(person => person.id === item.employeeId)?.name ?? "Team member"} · {item.bookingTitle} · {notificationTime(item.start, item.end)}</option>) : choices.bookings.map(item => <option key={item.id} value={item.id}>{item.title} · {notificationTime(item.start, item.end)}</option>)}</select></label>
          {!scheduleLoading && schedule && !(preset === "rental-response" ? choices.responses.length : choices.bookings.length) && <p className="schedule-small">{preset === "rental-response" ? "No upcoming studio rental offers are awaiting an app response." : "No upcoming studio rentals are recorded."}</p>}
          <Button type="button" variant="ghost" disabled={busy || scheduleLoading} onClick={() => void refreshSchedule()}><RefreshCw size={15} aria-hidden="true" />{scheduleError ? "Try loading rentals again" : "Reload rentals"}</Button>
          {staleRental && <div className="team-notification-rental-changed"><p>This rental or its team changed. Review the latest details before sending.</p>{currentSelection ? <Button type="button" variant="outline" disabled={busy} onClick={() => { if (preset === "rental-response") chooseOffer(currentSelection as RentalOffer); else chooseRental(currentSelection as Rental); }}>Use latest details</Button> : <p>Choose another current rental above.</p>}</div>}
        </div>}
        {preset && (!rentalMode || selected) && <>
          {preset === "rental-response" ? <div className="team-notification-locked-recipient"><span>Send to</span><strong>{people.find(person => person.id === offer?.employeeId)?.name ?? "Assigned team member"}</strong><small>The reminder asks them to accept or decline this offer.</small></div> : <fieldset className="team-notification-recipients" disabled={busy}><legend>Send to{preset === "upcoming-rental" ? " · Confirmed team" : ""}</legend><div className="team-notification-recipient-controls"><button type="button" disabled={!selectablePeople.length} onClick={() => { setRecipientIds(selectablePeople.map(person => person.id)); edit(); }}>Select all</button><button type="button" disabled={!recipientIds.length} onClick={() => { setRecipientIds([]); edit(); }}>Clear</button><span>{recipientIds.length} selected</span></div>
            <div className="team-notification-person-list">{selectablePeople.map(person => <label key={person.id}><input type="checkbox" checked={recipientIds.includes(person.id)} onChange={event => { const checked = event.currentTarget.checked; setRecipientIds(previous => checked ? [...new Set([...previous, person.id])] : previous.filter(id => id !== person.id)); edit(); }} /><span className="employee-avatar" style={{ background: teamAccent(person.id, person.accent) }} aria-hidden="true">{person.name.slice(0, 1)}</span><span>{person.name}</span></label>)}</div>{preset === "upcoming-rental" && !selectablePeople.length && <p className="schedule-small">No confirmed team is recorded for this rental. Custom message lets you choose other recipients.</p>}
          </fieldset>}
          {content && <>
            {(preset === "custom" || edited) && <><label className="team-notification-field"><span>Title <small id={titleCountId}>{content.title.length}/80</small></span><Input required maxLength={80} disabled={busy} value={content.title} aria-describedby={titleCountId} onChange={event => setContent({ title: event.target.value })} /></label><label className="team-notification-field"><span>Message <small id={bodyCountId}>{content.body.length}/360</small></span><Textarea required rows={3} maxLength={360} disabled={busy} value={content.body} aria-describedby={bodyCountId} onChange={event => setContent({ body: event.target.value })} /></label></>}
            {preset === "custom" && <label className="team-notification-field"><span>Open page</span><select value={content.target} disabled={busy} onChange={event => setContent({ target: event.target.value as Destination })}>{Object.entries(destinations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            <div className="team-notification-preview"><div><span>Message preview</span>{preset !== "custom" && preset !== "rental-response" && !edited && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEdited(content); edit(); }}><Pencil size={14} aria-hidden="true" />Edit message</Button>}</div><strong>{content.title || "Add a title"}</strong><p>{content.body || "Write your message above."}</p><small>Opens {destinations[content.target]}</small></div>
          </>}
        </>}
        {message && <p className="team-notification-message" role="status">{message}</p>}{error && <p className="team-notification-error" role="alert">{error}</p>}
      </form>
        <details className="team-notifications-history"><summary>Last 20 sent</summary>{historyLoading && <p role="status">Updating history…</p>}{historyError && <p role="alert">{historyError} <button type="button" disabled={historyLoading} onClick={() => void refreshHistory()}>Try again</button></p>}{!historyLoading && !historyError && !notices.length && <p>No reminders sent yet.</p>}<ul>{notices.map(notice => <li key={notice.id}><strong>{notice.title}</strong><p>{notice.body}</p><span>{notice.recipientIds.map(id => people.find(person => person.id === id)?.name ?? "Team member").join(", ")}</span><small><time dateTime={new Date(notice.createdAt).toISOString()}>{sentTime.format(notice.createdAt)}</time> · {destinations[notice.target] ?? "Inbox"}</small></li>)}</ul></details>
      </div>
      <DialogFooter className="team-notifications-footer"><span>{effectiveRecipients.length} recipient{effectiveRecipients.length === 1 ? "" : "s"}{content ? ` · Opens ${destinations[content.target]}` : ""}</span><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button><Button type="submit" form={formId} disabled={busy || !canSend}><Send size={16} aria-hidden="true" />{busy ? "Sending…" : error ? "Retry send" : preset === "custom" ? "Send notification" : "Send reminder"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
