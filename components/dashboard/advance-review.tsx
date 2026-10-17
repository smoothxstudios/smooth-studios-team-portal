"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dollars, formatDate, formatTime, teamAccent } from "@/lib/dashboard-presentation";
import type { Employee, PayrollReview, PayrollState } from "@/lib/dashboard-types";
import { teamRequest } from "@/lib/team-api";

export function AdvanceReview({ token, payroll, employees, onOpenSource, onReviewed }: {
  token: string; payroll?: PayrollState; employees: Employee[];
  onOpenSource: (kind: PayrollReview["kind"], id: string) => void;
  onReviewed: (reviews: PayrollReview[]) => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reviews, setReviews] = useState<PayrollReview[] | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setBusy(true); setError("");
    try {
      const result = await teamRequest<{ version: number; reviews: PayrollReview[] }>(token, "/payroll/reviews");
      if (result.version !== 1 || !Array.isArray(result.reviews)) throw new Error("Review details are updating. Please try again.");
      if (request === sequence.current) { setReviews(result.reviews); onReviewed(result.reviews); }
    } catch { if (request === sequence.current) setError("Review details couldn’t load. Your saved advance credit is unchanged. Try again."); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [token, onReviewed]);
  useEffect(() => {
    if (open) { setReviews(null); void refresh(); }
    return () => { sequence.current++; };
  }, [open, refresh]);
  const name = (id: string) => employees.find(person => person.id === id)?.name ?? id;
  const people = payroll?.reviewPeople ?? [];
  const label = people.length === 1 ? `${name(people[0].employeeId)} · Advance review` : "Advance review";
  const groups = [...new Set((reviews ?? []).map(item => item.employeeId))];
  return <>
    {Boolean(payroll?.reviewCount) && <div className="advance-review-strip">
      <AlertCircle size={17} aria-hidden="true" /><strong>{label}</strong>
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label={`Review ${payroll!.reviewCount} advance ${payroll!.reviewCount === 1 ? "item" : "items"}`}>Review <span>{payroll!.reviewCount}</span></Button>
    </div>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="advance-review-dialog">
        <DialogHeader><DialogTitle>Advance review</DialogTitle><DialogDescription>Saved advance credit stays in place. Check the record before making a pay correction.</DialogDescription></DialogHeader>
        <div className="advance-review-body" aria-busy={busy}>
          {error && <p className="schedule-warning" role="alert">{error}</p>}
          {busy && !reviews && <p role="status">Loading review details…</p>}
          {!busy && reviews?.length === 0 && <p role="status">No advance discrepancies remain in the current records.</p>}
          {groups.map(employeeId => <section className="advance-review-person" key={employeeId}>
            <h3><span aria-hidden="true" className="employee-avatar" style={{ background: teamAccent(employeeId) }}>{name(employeeId).slice(0, 1)}</span>{name(employeeId)}</h3>
            {reviews!.filter(item => item.employeeId === employeeId).map(item => <article className="advance-review-item" key={`${item.kind}:${item.sourceId}`}>
              <div className="advance-review-record"><strong>{item.customer || item.title}</strong>{item.customer && <span>{item.title}</span>}
                {item.start ? <span>{formatDate(item.start, true)} · {formatTime(item.start)}{item.kind === "rental" && item.end ? `–${formatTime(item.end)}` : ""}</span> : item.end && <span>Earning date · {formatDate(item.end, true)}</span>}
              </div>
              <p className="advance-review-reason">{item.reason}</p>
              <dl><div><dt>Advance credit kept</dt><dd>{dollars(item.appliedCents, true)}</dd></div><div><dt>Current earning</dt><dd>{item.currentAmountCents === null ? "Not in records" : dollars(item.currentAmountCents, true)}</dd></div>
                {item.cashFloorCents > 0 && <div><dt>Prior cash recorded</dt><dd>{dollars(item.cashFloorCents, true)}</dd></div>}
              </dl>
              <p className="advance-review-next">{item.nextStep}</p>
              <div className="advance-review-actions">
                {item.sourceAvailable && <Button variant="outline" onClick={() => { setOpen(false); onOpenSource(item.kind, item.sourceId); }}>Open {item.kind === "rental" ? "rental" : "task"}<ArrowUpRight size={15} /></Button>}
                <details><summary>Record reference</summary><code>{item.sourceId}</code><span>Credit first recorded {formatDate(item.creditedAt, true)}</span></details>
              </div>
            </article>)}
          </section>)}
        </div>
        <footer><Button variant="outline" onClick={() => setOpen(false)}>Close</Button><Button variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? "animate-spin" : ""} />{busy ? "Checking…" : "Check again"}</Button></footer>
      </DialogContent>
    </Dialog>
  </>;
}
