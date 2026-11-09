"use client";
import { useEffect, useRef, type PointerEvent } from "react";
import { stepSpring, shouldDismissSheet } from "@/lib/ui-spring.mjs";

/** A real drag target: scrollable fields keep their native scrolling and zoom. */
export function SheetHandle({ disabled, onDismiss }: { disabled: boolean; onDismiss: () => void }) {
  const handle = useRef<HTMLButtonElement>(null);
  const state = useRef({ y: 0, v: 0, frame: 0, pointer: -1, origin: 0, startY: 0, lastY: 0, lastAt: 0, moved: false });
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const content = () => handle.current?.closest<HTMLElement>('[data-slot="dialog-content"]');
  const paint = () => { const el = content(); if (el) el.style.transform = `translate3d(0, ${state.current.y}px, 0)`; };
  const settle = (target: number, close = false) => {
    const s = state.current; cancelAnimationFrame(s.frame);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      s.y = 0; s.v = 0; paint(); if (close) dismiss.current(); return;
    }
    let previous = performance.now();
    const tick = (now: number) => {
      const next = stepSpring(s.y, s.v, target, (now - previous) / 1000); previous = now;
      s.y = next.position; s.v = next.velocity; paint();
      if (Math.abs(s.y - target) < .5 && Math.abs(s.v) < 4) {
        s.frame = 0; s.y = target; s.v = 0; paint();
        if (close) { content()?.setAttribute('data-drag-dismissed', 'true'); dismiss.current(); }
      } else s.frame = requestAnimationFrame(tick);
    };
    s.frame = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(state.current.frame), []);
  const start = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0 || !e.isPrimary) return;
    const s = state.current; cancelAnimationFrame(s.frame);
    s.pointer = e.pointerId; s.origin = e.clientY - s.y; s.startY = e.clientY; s.lastY = e.clientY; s.lastAt = e.timeStamp; s.moved = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const s = state.current; if (s.pointer !== e.pointerId) return;
    const raw = e.clientY - s.origin;
    if (Math.abs(e.clientY - s.startY) > 3) s.moved = true;
    const dt = Math.max(8, e.timeStamp - s.lastAt);
    s.v = .6 * s.v + .4 * (e.clientY - s.lastY) * 1000 / dt;
    s.y = raw < 0 ? raw / (1 + Math.abs(raw) / 24) : raw;
    s.lastY = e.clientY; s.lastAt = e.timeStamp; paint();
  };
  const end = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const s = state.current; if (s.pointer !== e.pointerId) return;
    s.pointer = -1;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (e.timeStamp - s.lastAt > 100) s.v = 0;
    const height = content()?.offsetHeight ?? innerHeight;
    const close = !cancel && shouldDismissSheet(s.y, s.v, height);
    settle(close ? height + 40 : 0, close);
  };
  return <button ref={handle} type="button" className="app-sheet-handle" aria-label="Close sheet" disabled={disabled}
    onPointerDown={start} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)}
    onClick={e => { if (e.detail === 0 || !state.current.moved) onDismiss(); else e.preventDefault(); }}><span /></button>;
}
