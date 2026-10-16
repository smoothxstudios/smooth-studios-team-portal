"use client";
import { Bell, CalendarDays, Check, CheckCheck, ClipboardList, RefreshCw, Sparkles, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlertsState, DashboardAlert } from "@/lib/use-alerts";

const stamp = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function UnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className="alerts-count" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span> : null;
}

export function AlertsPage({ state, onOpen }: { state: AlertsState; onOpen: (alert: DashboardAlert) => void }) {
  const open = async (alert: DashboardAlert) => { if (await state.markRead(alert)) onOpen(alert); };
  return <section className="alerts-page" aria-label="Your alerts">
    <div className="alerts-heading"><div><h2>Alerts</h2><p>Assignment updates and quiz reminders, all in one place.</p></div>
      <Button variant="outline" size="icon" aria-label="Refresh alerts" disabled={state.busy} onClick={() => void state.refresh()}><RefreshCw size={17} /></Button>
    </div>
    <div className="alerts-controls">
      <div className="alerts-filters" role="group" aria-label="Filter alerts">
        <button aria-pressed={state.filter === "all"} disabled={state.busy} onClick={() => state.chooseFilter("all")}>All</button>
        <button aria-pressed={state.filter === "unread"} disabled={state.busy} onClick={() => state.chooseFilter("unread")}>Unread <UnreadBadge count={state.unreadCount} /></button>
      </div>
      <Button variant="ghost" disabled={state.busy || state.loading || !state.unreadCount} onClick={() => void state.markRead()}><CheckCheck size={16} />Mark all read</Button>
    </div>
    {state.error && <p className="schedule-warning" role="alert">{state.error} <button onClick={() => void state.refresh()}>Try again</button></p>}
    {state.loading && !state.alerts.length ? <p className="alerts-empty" role="status">Loading alerts…</p> : !state.alerts.length && !state.error ?
      <div className="alerts-empty"><Bell size={28} /><h3>{state.filter === "unread" ? "You’re all caught up" : "No alerts yet"}</h3><p>{state.filter === "unread" ? "Switch to All to see your notification history." : "New assignment updates and quiz reminders will appear here, even with push turned off."}</p></div> : null}
    <ul className="alerts-list">
      {state.alerts.map(alert => {
        const Icon = alert.target === "quiz" ? Sparkles : alert.target === "creative" ? ClipboardList : CalendarDays;
        const expired = alert.expiresAt !== null && alert.expiresAt <= Date.now();
        return <li key={alert.id} className={`alert-card${alert.readAt ? "" : " is-unread"}`}>
          <span className="alert-icon"><Icon size={20} /></span>
          <div className="alert-content"><div className="alert-title"><h3>{alert.title}</h3>{!alert.readAt && <span className="alert-unread-dot" aria-label="Unread" />}</div>
            <p>{alert.body}</p><time dateTime={new Date(alert.createdAt).toISOString()}>{stamp.format(alert.createdAt)}</time>
            {expired && <small className="alert-expired">Earlier quiz reminder · Open to see today’s quiz.</small>}
            <div className="alert-actions"><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void open(alert)}>{alert.target === "quiz" ? "Open Daily Quiz" : alert.target === "availability" ? "View availability" : "View details"}<ArrowUpRight size={15} /></Button>
              {!alert.readAt && <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => void state.markRead(alert)}><Check size={15} />Mark read</Button>}</div>
          </div>
        </li>;
      })}
    </ul>
    {state.nextCursor && <Button variant="outline" disabled={state.busy} onClick={() => void state.loadMore()}>{state.busy ? "Loading…" : "Load more"}</Button>}
  </section>;
}
