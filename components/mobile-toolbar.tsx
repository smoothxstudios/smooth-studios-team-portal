"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bell, CalendarDays, ClipboardList, House, Users, WalletCards } from "lucide-react";
import { UnreadBadge } from "@/components/alerts";
import { useSidebar } from "@/components/ui/sidebar";
import { attachToolbarSlide, attachToolbarScroll, mobileToolbarItems } from "@/lib/mobile-toolbar.mjs";

type ToolbarView = "overview" | "team" | "creative" | "scheduling" | "alerts" | "payouts";
const icons = { home: House, team: Users, work: ClipboardList, schedule: CalendarDays, alerts: Bell, payouts: WalletCards };

export function MobileToolbar({ isOwner, view, unread, onNavigate }: { isOwner: boolean; view: string; unread: number; onNavigate: (view: ToolbarView) => void }) {
  const { setOpenMobile } = useSidebar();
  const nav = useRef<HTMLElement>(null);
  const items = useMemo(() => mobileToolbarItems(isOwner), [isOwner]);
  const [pendingView, setPendingView] = useState(view);
  const [pending, startTransition] = useTransition();
  const activeIndex = items.findIndex(item => item.key === (pending ? pendingView : view));
  const active = useRef(activeIndex);
  const navigate = useRef(onNavigate);
  const select = useRef<(index: number) => void>(() => {});
  useLayoutEffect(() => { navigate.current = onNavigate; }, [onNavigate]);
  useLayoutEffect(() => {
    active.current = activeIndex;
    if (!nav.current || nav.current.dataset.dragging === "true") return;
    nav.current.style.setProperty("--toolbar-position", String(Math.max(0, activeIndex)));
    const indicator = nav.current.querySelector<HTMLElement>(".mobile-toolbar-indicator");
    if (indicator) indicator.dataset.visible = String(activeIndex >= 0);
  }, [activeIndex]);

  useEffect(() => {
    const bar = nav.current;
    if (!bar) return;
    let frame = 0;
    const buttons = Array.from(bar.querySelectorAll<HTMLElement>("button[data-toolbar-index]"));
    const indicator = bar.querySelector<HTMLElement>(".mobile-toolbar-indicator");
    // Paint once per animation frame. Finger movement doesn't re-render React or
    // interrupt pointer listeners when background dashboard data arrives.
    const paint = (position: number, dragging: boolean, visible = true) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        bar.dataset.dragging = String(dragging);
        bar.style.setProperty("--toolbar-position", String(Math.max(0, position)));
        if (indicator) indicator.dataset.visible = String(visible);
        buttons.forEach((button, index) => {
          const strength = dragging ? Math.max(0, 1 - Math.abs(position - index)) : 0;
          button.style.setProperty("--tab-activation", String(strength));
          button.style.setProperty("--tab-color", `${strength * 100}%`);
        });
      });
    };
    const choose = (index: number) => {
      active.current = index;
      paint(index, false);
      setPendingView(items[index].key);
      startTransition(() => { setOpenMobile(false); navigate.current(items[index].key); });
    };
    select.current = choose;
    const detachSlide = attachToolbarSlide(bar, {
      onPreview: preview => paint(preview?.position ?? active.current, Boolean(preview), Boolean(preview) || active.current >= 0),
      onSelect: choose,
    });
    const detachScroll = attachToolbarScroll(bar);
    return () => { detachSlide(); detachScroll(); cancelAnimationFrame(frame); };
  }, [items, setOpenMobile]);

  return <nav ref={nav} className="mobile-toolbar" aria-label="Quick navigation">
    <span className="mobile-toolbar-indicator" aria-hidden="true" />
    {items.map((item, index) => {
      const Icon = icons[item.icon];
      return <button key={item.key} type="button" data-toolbar-index={index} data-selected={activeIndex === index}
        aria-label={item.key === "creative" ? "Creative Work" : item.label} aria-current={view === item.key ? "page" : undefined}
        onClick={() => select.current(index)}>
        <span className="toolbar-icon"><Icon size={21} aria-hidden="true" />{item.key === "alerts" && <UnreadBadge count={unread} />}</span><span>{item.label}</span>
      </button>;
    })}
  </nav>;
}
