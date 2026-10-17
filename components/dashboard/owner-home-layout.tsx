"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { DEFAULT_DASHBOARD_ORDER, validDashboardOrder } from "@/lib/dashboard-layout.mjs";
import { dashboardDragStarted, dashboardDropPosition, moveDashboardSection } from "@/lib/owner-layout-editor.mjs";
import { teamRequest } from "@/lib/team-api";

export type DashboardSectionId = "upcoming" | "attention" | "finances" | "hours" | "creative" | "reports";
type Layout = { revision: number; order: DashboardSectionId[] };
type Drag = { id: DashboardSectionId; pointerId: number; startX: number; startY: number; y: number; offset: number; active: boolean; frame: number; capture: HTMLOListElement };
const sectionLabels: Record<DashboardSectionId, string> = { upcoming: "Coming up", attention: "Needs attention", finances: "Financial summary", hours: "Team hours", creative: "Creative work", reports: "Financial reports" };
const defaultOrder = () => [...DEFAULT_DASHBOARD_ORDER] as DashboardSectionId[];
const conflictMessage = "The Home layout changed on another device. Refresh before saving your changes.";
let lastConfirmedLayout: { token: string; layout: Layout } | null = null;
const cachedLayout = (token: string) => lastConfirmedLayout?.token === token ? lastConfirmedLayout.layout : null;

export function OwnerHomeLayout({ token, sections }: { token: string; sections: Record<DashboardSectionId, ReactNode> }) {
  const [saved, setSaved] = useState<Layout | null>(() => cachedLayout(token)), [fresh, setFresh] = useState(false), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [saveError, setSaveError] = useState(""), [conflict, setConflict] = useState(false);
  const [draft, setDraft] = useState<DashboardSectionId[]>(defaultOrder), [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [dragging, setDragging] = useState<DashboardSectionId | null>(null), [announcement, setAnnouncement] = useState("");
  const draftRef = useRef(draft), sequence = useRef(0), saving = useRef(false), drag = useRef<Drag | null>(null);
  const body = useRef<HTMLDivElement>(null), list = useRef<HTMLOListElement>(null), heading = useRef<HTMLHeadingElement>(null), rows = useRef(new Map<DashboardSectionId, HTMLLIElement>());
  const instructionsId = useId();

  const updateDraft = useCallback((next: DashboardSectionId[]) => { draftRef.current = next; setDraft(next); }, []);
  const stopDrag = useCallback((announce = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    cancelAnimationFrame(current.frame);
    if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    setDragging(null);
    if (announce && current.active) setAnnouncement(`${sectionLabels[current.id]} moved to position ${draftRef.current.indexOf(current.id) + 1} of 6.`);
  }, []);

  const load = useCallback(async (replaceDraft = false) => {
    if (saving.current) return false;
    const id = ++sequence.current;
    setLoading(true);
    try {
      const result = await teamRequest<Layout>(token, "/dashboard-layout");
      if (!Number.isSafeInteger(result.revision) || result.revision < 0 || !validDashboardOrder(result.order)) throw new Error("Invalid Home layout.");
      if (id !== sequence.current) return false;
      const next = { revision: result.revision, order: [...result.order] };
      lastConfirmedLayout = { token, layout: next };
      setSaved(next); setFresh(true); setLoadError("");
      if (replaceDraft) { stopDrag(); updateDraft([...next.order]); setDraftRevision(next.revision); setSaveError(""); setConflict(false); setAnnouncement("Saved layout loaded."); }
      return true;
    } catch {
      if (id === sequence.current) setLoadError("Saved Home layout couldn’t load. Your saved order has not been changed.");
      return false;
    } finally { if (id === sequence.current) setLoading(false); }
  }, [token, stopDrag, updateDraft]);
  const refresh = useCallback(() => load(), [load]);
  useRefreshSource(refresh);
  useEffect(() => {
    setSaved(cachedLayout(token)); setFresh(false); setOpen(false); setSaveError(""); setConflict(false); setDraftRevision(null); saving.current = false; setBusy(false);
    void load();
    return () => { sequence.current++; stopDrag(); };
  }, [load, stopDrag]);

  const openEditor = () => {
    updateDraft(saved ? [...saved.order] : defaultOrder()); setDraftRevision(fresh ? saved?.revision ?? null : null);
    setSaveError(""); setConflict(false); setAnnouncement(""); setOpen(true);
  };
  const move = (id: DashboardSectionId, position: number) => {
    const next = moveDashboardSection(draftRef.current, id, position);
    if (next === draftRef.current) return;
    updateDraft(next); if (!conflict) setSaveError(""); setAnnouncement(`${sectionLabels[id]} moved to position ${next.indexOf(id) + 1} of 6.`);
  };
  const positionDraggedRow = () => {
    const current = drag.current;
    if (!current?.active) return;
    const otherCenters = draftRef.current.filter(id => id !== current.id).flatMap(id => {
      const rect = rows.current.get(id)?.getBoundingClientRect();
      return rect ? [rect.top + rect.height / 2] : [];
    });
    updateDraft(moveDashboardSection(draftRef.current, current.id, dashboardDropPosition(current.y + current.offset, otherCenters)));
  };
  const tickDrag = () => {
    const current = drag.current, scroll = body.current;
    if (!current?.active || !scroll) return;
    const rect = scroll.getBoundingClientRect(), edge = 40;
    const speed = current.y < rect.top + edge ? -Math.min(12, (rect.top + edge - current.y) / 3) : current.y > rect.bottom - edge ? Math.min(12, (current.y - rect.bottom + edge) / 3) : 0;
    if (speed) scroll.scrollTop += speed;
    positionDraggedRow();
    current.frame = requestAnimationFrame(tickDrag);
  };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: DashboardSectionId) => {
    if (busy || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    stopDrag();
    const rect = rows.current.get(id)?.getBoundingClientRect(), capture = list.current;
    if (!rect || !capture) return;
    capture.setPointerCapture(event.pointerId);
    drag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, y: event.clientY, offset: rect.top + rect.height / 2 - event.clientY, active: false, frame: 0, capture };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLOListElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.y = event.clientY;
    if (!current.active && dashboardDragStarted(event.clientX - current.startX, event.clientY - current.startY)) {
      current.active = true; setDragging(current.id); if (!conflict) setSaveError(""); current.frame = requestAnimationFrame(tickDrag);
    }
  };
  const save = async () => {
    if (saving.current || draftRevision === null || !saved || !fresh || conflict || !validDashboardOrder(draftRef.current)) return;
    stopDrag(); saving.current = true; setBusy(true); setSaveError("");
    const id = ++sequence.current;
    try {
      const result = await teamRequest<Layout>(token, "/dashboard-layout", { revision: draftRevision, order: draftRef.current }, "PATCH");
      if (id !== sequence.current) return;
      if (!Number.isSafeInteger(result.revision) || result.revision < 0 || !validDashboardOrder(result.order)) throw new Error("The save could not be confirmed. Reload the saved layout to check it.");
      const next = { revision: result.revision, order: [...result.order] };
      lastConfirmedLayout = { token, layout: next };
      setSaved(next); setFresh(true); setLoadError(""); setLoading(false); setOpen(false);
    } catch (cause) {
      if (id === sequence.current) {
        const message = cause instanceof Error ? cause.message : "The save could not be confirmed. Reload the saved layout to check it.";
        setConflict(message === conflictMessage); setSaveError(message === conflictMessage ? "The Home layout changed on another device. Your unsaved order is still here. Reload the saved layout before making more changes." : message);
      }
    } finally { if (id === sequence.current) { saving.current = false; setBusy(false); setLoading(false); } }
  };

  return <div className="owner-overview owner-home-layout">
    <div className="owner-home-layout-controls"><div>{loading && !saved && <span role="status">Loading Home layout…</span>}{loadError && <span role="status">{loadError} <button type="button" disabled={loading} onClick={() => void load()}>Try again</button></span>}</div><Button type="button" variant="ghost" disabled={loading && !fresh} onClick={openEditor}><SlidersHorizontal size={16} aria-hidden="true" />Edit layout</Button></div>
    {(saved?.order ?? defaultOrder()).map(id => <div key={id} className="owner-home-section" data-home-section={id}>{sections[id]}</div>)}
    <Dialog open={open} onOpenChange={value => { if (!busy) { stopDrag(); setOpen(value); } }}>
      <DialogContent className="schedule-modal owner-layout-dialog" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}>
        <DialogHeader className="owner-layout-heading"><div><DialogTitle ref={heading} tabIndex={-1}>Edit Home layout</DialogTitle><DialogDescription id={instructionsId}>Drag a handle or use the arrows to change the order.</DialogDescription></div><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Close layout editor" onClick={() => { stopDrag(); setOpen(false); }}><X size={20} aria-hidden="true" /></Button></DialogHeader>
        <div ref={body} className="owner-layout-body">
          {loadError && <p className="owner-layout-warning" role="status">{loadError}</p>}
          {draftRevision === null && <p className="owner-layout-warning">Load your saved layout before saving any changes. <button type="button" disabled={loading || busy} onClick={() => void load(true)}>{loading ? "Loading…" : "Load saved layout"}</button></p>}
          <ol ref={list} className="owner-layout-list" aria-label="Home section order" aria-describedby={instructionsId} onPointerMove={moveDrag} onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) stopDrag(true); }} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) stopDrag(); }} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) stopDrag(); }}>
            {draft.map((id, index) => <li key={id} ref={node => { if (node) rows.current.set(id, node); else rows.current.delete(id); }} data-dragging={dragging === id}>
              <button type="button" className="owner-layout-drag" disabled={busy} aria-label={`Move ${sectionLabels[id]}; position ${index + 1} of 6`} title="Drag to reorder" onPointerDown={event => startDrag(event, id)} onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); move(id, index + (event.key === "ArrowUp" ? -1 : 1)); } }}><GripVertical size={20} aria-hidden="true" /></button>
              <span><small aria-hidden="true">{index + 1}</small><strong>{sectionLabels[id]}</strong></span>
              <button type="button" disabled={busy || index === 0} aria-label={`Move ${sectionLabels[id]} up`} onClick={() => move(id, index - 1)}><ArrowUp size={18} aria-hidden="true" /></button>
              <button type="button" disabled={busy || index === draft.length - 1} aria-label={`Move ${sectionLabels[id]} down`} onClick={() => move(id, index + 1)}><ArrowDown size={18} aria-hidden="true" /></button>
            </li>)}
          </ol>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
          {saveError && <p className="owner-layout-warning" role="alert">{saveError}</p>}
          {(conflict || saveError || (loadError && saved)) && <Button type="button" variant="outline" disabled={loading || busy} onClick={() => void load(true)}>{loading ? "Loading…" : "Reload saved layout"}</Button>}
        </div>
        <DialogFooter className="owner-layout-footer"><Button type="button" variant="ghost" disabled={busy} onClick={() => { stopDrag(); updateDraft(defaultOrder()); if (!conflict) setSaveError(""); setAnnouncement("Default order restored. Save layout to apply it."); }}><RotateCcw size={16} aria-hidden="true" />Reset to default</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { stopDrag(); setOpen(false); }}>Cancel</Button><Button type="button" disabled={busy || loading || !saved || !fresh || draftRevision === null || conflict} onClick={() => void save()}>{busy ? "Saving…" : "Save layout"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
