"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { attachScrollTapGuard } from "@/lib/scroll-tap-guard.mjs";
import { alertBody, groupAlerts } from "@/lib/alert-presentation.mjs";
import { Bell, Banknote, CalendarDays, Check, CheckCheck, Mail, ChevronDown, ClipboardList, Sparkles, ArrowUpRight, MoreHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AlertsState, DashboardAlert } from "@/lib/use-alerts";

const stamp = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function UnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className="alerts-count" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span> : null;
}

function AlertOptions({ alert, state, onOpen }: { alert: DashboardAlert; state: AlertsState; onOpen: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && menu.current) return attachScrollTapGuard(menu.current); }, [open]);
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild onPointerDown={event => event.preventDefault()}>
      <button type="button" className="alert-row-action" disabled={state.busy} onClick={() => setOpen(value => !value)} aria-label={`More options: ${alert.title}`} title="Alert options"><MoreHorizontal size={19} aria-hidden="true" /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent ref={menu} className="alert-actions-menu" align="end" collisionPadding={8}>
      <DropdownMenuItem disabled={state.busy} onSelect={() => void onOpen()}><ArrowUpRight size={16} aria-hidden="true" />Open details</DropdownMenuItem>
      {!alert.readAt && <DropdownMenuItem disabled={state.busy} onSelect={() => void state.markRead(alert)}><Check size={16} aria-hidden="true" />Mark read</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={state.busy} onSelect={() => void state.deleteAlert(alert)}><Trash2 size={16} aria-hidden="true" />Delete alert</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function AlertsPage({ state, onOpen, isOwner = false, action }: { isOwner?: boolean; state: AlertsState; onOpen: (alert: DashboardAlert) => void; action?: ReactNode }) {
  const page = useRef<HTMLElement>(null);
  const bulkMenu = useRef<HTMLDivElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState<DashboardAlert | null>(null);
  useEffect(() => { if (page.current) return attachScrollTapGuard(page.current); }, []);
  useEffect(() => { if (bulkOpen && bulkMenu.current) return attachScrollTapGuard(bulkMenu.current); }, [bulkOpen]);
  const groups = isOwner ? groupAlerts(state.alerts) : [{ id: "all", person: null, alerts: state.alerts }];
  const open = async (alert: DashboardAlert) => {
    if (alert.kind === "notice" && alert.target === "alerts") setNotice(alert);
    else onOpen(alert);
    await state.markRead(alert, true);
  };
  return <section ref={page} className="alerts-page" aria-label="Your alerts">
    <div className="alerts-heading"><h2>Alerts</h2>{action}</div>
    <div className="alerts-controls">
      <div className="alerts-filters" role="group" aria-label="Filter alerts">
        <button aria-pressed={state.filter === "all"} disabled={state.busy} onClick={() => state.chooseFilter("all")}>All</button>
        <button aria-pressed={state.filter === "unread"} disabled={state.busy} onClick={() => state.chooseFilter("unread")}>Unread <UnreadBadge count={state.unreadCount} /></button>
      </div>
      <DropdownMenu open={bulkOpen} onOpenChange={setBulkOpen}>
        <DropdownMenuTrigger asChild onPointerDown={event => event.preventDefault()}><Button variant="ghost" disabled={state.busy || state.loading || !state.throughSequence} onClick={() => setBulkOpen(value => !value)}>Mark all <ChevronDown size={15} aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent ref={bulkMenu} className="alert-actions-menu" align="end" collisionPadding={8}>
          <DropdownMenuItem disabled={state.busy || !state.unreadCount} onSelect={() => void state.markRead()}><CheckCheck size={16} aria-hidden="true" />Read</DropdownMenuItem>
          <DropdownMenuItem disabled={state.busy || !state.throughSequence} onSelect={() => void state.markAllUnread()}><Mail size={16} aria-hidden="true" />Unread</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {state.error && <p className="schedule-warning" role="alert">{state.error} <button onClick={() => void state.refresh()}>Try again</button></p>}
    {state.deletion && <div className="alerts-undo" role="status"><span>Alert deleted</span><button type="button" disabled={state.busy} onClick={() => void state.undoDelete()} aria-label={`Undo deletion: ${state.deletion.alert.title}`}>Undo</button></div>}
    {state.loading && !state.alerts.length ? <p className="alerts-empty" role="status">Loading alerts…</p> : !state.alerts.length && !state.error ?
      <div className="alerts-empty"><Bell size={28} /><h3>{state.filter === "unread" ? "You’re all caught up" : "No alerts yet"}</h3><p>{state.filter === "unread" ? "Switch to All to see your notification history." : "New assignment updates and quiz reminders will appear here, even with push turned off."}</p></div> : null}
    {groups.filter(group => group.alerts.length).map(group => <section className="alerts-person-group" key={group.id} aria-label={isOwner ? `${group.person?.name ?? "Other"} alerts` : "Alert history"}>
      {isOwner && <header className="person-section-heading"><span className="employee-avatar" style={{ background: group.person?.color ?? "#64748b" }}>{group.person?.name.slice(0, 1) ?? "•"}</span><h3>{group.person?.name ?? "Other updates"}</h3><small>{group.alerts.length} alert{group.alerts.length === 1 ? "" : "s"}</small></header>}
      <ul className="alerts-list">
      {group.alerts.map((alert: DashboardAlert) => {
        const Icon = alert.kind === "notice" ? Bell : alert.target === "quiz" ? Sparkles : alert.target === "creative" ? ClipboardList : alert.target === "payouts" ? Banknote : CalendarDays;
        const expired = alert.expiresAt !== null && alert.expiresAt <= Date.now();
        return <li key={alert.id} className={`alert-card${alert.readAt ? "" : " is-unread"}`}>
          <button type="button" className="alert-open" disabled={state.busy} onClick={() => void open(alert)} aria-label={`${alert.title}. ${alert.target === "settings" ? "Open Settings" : alert.target === "alerts" ? "Read notification" : alert.target === "quiz" ? "Open Daily Quiz" : alert.target === "availability" ? "View availability" : "View details"}`}>
            <span className="alert-content"><span className="alert-title"><Icon className="alert-kind-icon" size={15} aria-hidden="true" /><strong>{alert.title}</strong><ArrowUpRight className="alert-open-arrow" size={14} aria-hidden="true" /></span>
              <span className="alert-preview">{alertBody(alert.body) || "Open this alert for details."}</span>
              <span className="alert-meta"><time dateTime={new Date(alert.createdAt).toISOString()}>{stamp.format(alert.createdAt)}</time><span className="alert-status" data-unread={!alert.readAt}>{alert.readAt ? "Read" : "Unread"}{expired ? " · Earlier reminder" : ""}</span></span>
            </span>
          </button>
          <div className="alert-row-actions">
            <AlertOptions alert={alert} state={state} onOpen={() => open(alert)} />
          </div>
        </li>;
      })}
    </ul></section>)}
    {state.nextCursor && <Button variant="outline" disabled={state.busy} onClick={() => void state.loadMore()}>{state.busy ? "Loading…" : "Load more"}</Button>}
    <Dialog open={Boolean(notice)} onOpenChange={value => { if (!value) setNotice(null); }}>
      <DialogContent className="schedule-modal" showCloseButton={false}>
        <DialogHeader><div className="schedule-row"><DialogTitle>{notice?.title}</DialogTitle><Button type="button" variant="ghost" size="icon" aria-label="Close notification" onClick={() => setNotice(null)}><X size={20} /></Button></div><DialogDescription>From Smooth{notice ? ` · ${stamp.format(notice.createdAt)}` : ""}</DialogDescription></DialogHeader>
        <p className="notification-full-message">{notice?.body}</p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={state.busy} onClick={async () => { if (notice && await state.deleteAlert(notice)) setNotice(null); }}><Trash2 size={16} />Delete</Button>
          {notice && notice.target !== "alerts" && <Button type="button" onClick={() => { onOpen(notice); setNotice(null); }}>{notice.target === "settings" ? "Open Settings" : notice.target === "availability" ? "Open Availability" : notice.target === "creative" ? "Open Creative work" : notice.targetId ? "Open assignment" : "Open Schedule"}<ArrowUpRight size={16} /></Button>}
          <Button type="button" variant="ghost" onClick={() => setNotice(null)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
