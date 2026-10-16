"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, CalendarDays, ClipboardList, House, Users, WalletCards } from "lucide-react";
import { UnreadBadge } from "@/components/alerts";
import { useSidebar } from "@/components/ui/sidebar";
import { attachToolbarSlide, mobileToolbarItems } from "@/lib/mobile-toolbar.mjs";

type ToolbarView = "overview" | "team" | "creative" | "scheduling" | "alerts" | "payouts";
const icons = { home: House, team: Users, work: ClipboardList, schedule: CalendarDays, alerts: Bell, payouts: WalletCards };

export function MobileToolbar({ isOwner, view, unread, onNavigate }: { isOwner: boolean; view: string; unread: number; onNavigate: (view: ToolbarView) => void }) {
  const { setOpenMobile } = useSidebar();
  const nav = useRef<HTMLElement>(null);
  const items = useMemo(() => mobileToolbarItems(isOwner), [isOwner]);
  const [preview, setPreview] = useState<{ position: number; index: number } | null>(null);
  useEffect(() => {
    if (!nav.current) return;
    return attachToolbarSlide(nav.current, {
      onPreview: setPreview,
      onSelect: index => { setOpenMobile(false); onNavigate(items[index].key); },
    });
  }, [items, onNavigate, setOpenMobile]);

  const activeIndex = items.findIndex(item => item.key === view);
  const position = preview?.position ?? Math.max(0, activeIndex);
  return <nav ref={nav} className="mobile-toolbar" aria-label="Quick navigation" data-dragging={Boolean(preview)}
    style={{ "--toolbar-position": position } as CSSProperties}>
    <span className="mobile-toolbar-indicator" aria-hidden="true" data-visible={Boolean(preview) || activeIndex >= 0} />
    {items.map((item, index) => {
      const Icon = icons[item.icon];
      return <button key={item.key} type="button" data-toolbar-index={index} data-preview={preview?.index === index}
        aria-label={item.key === "creative" ? "Creative Work" : item.label} aria-current={view === item.key ? "page" : undefined}
        onClick={() => { setOpenMobile(false); onNavigate(item.key); }}>
        <span className="toolbar-icon"><Icon size={21} aria-hidden="true" />{item.key === "alerts" && <UnreadBadge count={unread} />}</span><span>{item.label}</span>
      </button>;
    })}
  </nav>;
}
