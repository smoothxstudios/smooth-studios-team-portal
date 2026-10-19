"use client";
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { plannerTimeText } from '@/lib/planner-time.mjs';
export function PlannerDialog({ open, onClose, busy, title, description, wide = true, children }: {
    open: boolean;
    onClose: () => void;
    busy: boolean;
    title: string;
    description: ReactNode;
    wide?: boolean;
    children: ReactNode;
}) {
    return <Dialog open={open} onOpenChange={value => { if (!busy && !value)
        onClose(); }}>
    <DialogContent className={`schedule-modal${wide ? ' planner-modal' : ''}`} closeDisabled={busy}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}
export function PlannerError({ error }: {
    error: string;
}) {
    return error ? <p className="schedule-error" role="alert">{plannerTimeText(error)}</p> : null;
}
