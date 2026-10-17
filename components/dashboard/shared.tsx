"use client";

import { dollars } from "@/lib/dashboard-presentation";
import {
CalendarDays
} from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`studio-logo ${compact ? "studio-logo-compact" : ""}`}>
      {/* The relative URL keeps the brand asset compatible with a GitHub Pages base path. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./smooth-studios-logo.png" alt="Smooth Studios" />
    </div>
  );
}

export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><p>{label}</p>{payload.map((item) => <div key={item.name}><span style={{ background: item.color }} />{item.name}<strong>{dollars(item.value)}</strong></div>)}</div>;
}

export function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><CalendarDays size={28} /><strong>{title}</strong><p>{copy}</p></div>;
}
