"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function ScheduleConfirmation({ label = "Confirm change", children }: { label?: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, []);
  return <section ref={panel} className="schedule-confirm-inline" role="group" aria-label={label}>{children}</section>;
}
