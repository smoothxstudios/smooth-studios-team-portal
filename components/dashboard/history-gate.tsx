"use client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useEffect, useState, type ReactNode } from "react";

/** Never present a partial history as a complete list or payment form. */
export function HistoryGate({ deferred, load, children, onCancel }: { deferred?: boolean; load: () => Promise<boolean>; children: ReactNode; onCancel?: () => void }) {
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(false);
  useEffect(() => {
    if (!deferred) return;
    let active = true;
    void load().then(ok => { if (active && !ok) setError(true); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [deferred, load, attempt]);
  if (!deferred) return children;
  const notice = <div className="panel" role="status" style={{ padding: 20 }}>
    {error ? <>History couldn’t load. <button onClick={() => { setError(false); setAttempt(value => value + 1); }}>Try again</button></> : "Loading history…"}
  </div>;
  return onCancel ? <Dialog open onOpenChange={open => { if (!open) onCancel(); }}><DialogContent data-history-loading><DialogTitle>Loading records</DialogTitle><DialogDescription>Your appointment and payment history will appear here.</DialogDescription>{notice}</DialogContent></Dialog> : notice;
}
