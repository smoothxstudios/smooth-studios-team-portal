'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, Check, Moon, RefreshCw, Sun, WifiOff, type LucideIcon } from 'lucide-react';
import { ThemeProvider, useTheme } from 'next-themes';
import { attachToolbarSlide, attachToolbarScroll } from '@/lib/mobile-toolbar.mjs';
import { attachPullToRefresh, PULL_REFRESH_THRESHOLD } from '@/lib/pull-to-refresh.mjs';

export function ProductionTheme({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="smooth-production-theme">{children}</ThemeProvider>;
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  const label = dark ? 'Use light theme' : 'Use dark theme';
  return <button type="button" className="production-theme-toggle" aria-label={label} title={label} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}</button>;
}

export type ProductionToolbarItem = { key: string; label: string; icon: LucideIcon };

export function ProductionToolbar({ items, active, onNavigate, hidden = false, disabled = false }: {
  items: ProductionToolbarItem[];
  active: string;
  onNavigate: (key: string) => void | Promise<void>;
  hidden?: boolean;
  disabled?: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const [pendingKey, setPendingKey] = useState(active);
  const [pending, startTransition] = useTransition();
  const index = items.findIndex(item => item.key === (pending ? pendingKey : active));
  const currentIndex = useRef(index);
  const latest = useRef({ items, onNavigate, disabled, hidden });
  const select = useRef<(index: number) => void>(() => {});
  // The workspace changes the tabs when a production is opened. Rebind the
  // measured buttons only when their keys change, not on every data refresh.
  const itemKeys = items.map(item => item.key).join('\u0000');
  useLayoutEffect(() => { latest.current = { items, onNavigate, disabled, hidden }; }, [items, onNavigate, disabled, hidden]);
  useLayoutEffect(() => {
    currentIndex.current = index;
    if (!nav.current || nav.current.dataset.dragging === 'true') return;
    nav.current.style.setProperty('--toolbar-position', String(Math.max(0, index)));
    const indicator = nav.current.querySelector<HTMLElement>('.production-toolbar-indicator');
    if (indicator) indicator.dataset.visible = String(index >= 0);
    nav.current.dataset.scrollHidden = 'false';
  }, [index, itemKeys]);
  useEffect(() => {
    const bar = nav.current;
    if (!bar) return;
    let frame = 0;
    const buttons = Array.from(bar.querySelectorAll<HTMLElement>('button[data-toolbar-index]'));
    const indicator = bar.querySelector<HTMLElement>('.production-toolbar-indicator');
    const paint = (position: number, dragging: boolean, visible = true) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        bar.dataset.dragging = String(dragging);
        bar.style.setProperty('--toolbar-position', String(Math.max(0, position)));
        if (indicator) indicator.dataset.visible = String(visible);
        buttons.forEach((button, i) => {
          const strength = dragging ? Math.max(0, 1 - Math.abs(position - i)) : 0;
          button.style.setProperty('--tab-activation', String(strength));
          button.style.setProperty('--tab-color', `${strength * 100}%`);
        });
      });
    };
    const choose = (i: number) => {
      const current = latest.current;
      const item = current.items[i];
      if (current.disabled || current.hidden || !item) return;
      currentIndex.current = i;
      paint(i, false);
      setPendingKey(item.key);
      const navigation = current.onNavigate(item.key);
      startTransition(async () => { await navigation; });
    };
    select.current = choose;
    const detachSlide = attachToolbarSlide(bar, {
      onPreview: preview => {
        if (latest.current.disabled || latest.current.hidden) return;
        paint(preview?.position ?? currentIndex.current, Boolean(preview), Boolean(preview) || currentIndex.current >= 0);
      },
      onSelect: choose,
    });
    const detachScroll = attachToolbarScroll(bar);
    return () => {
      detachSlide(); detachScroll(); cancelAnimationFrame(frame);
      delete bar.dataset.dragging;
    };
  }, [itemKeys]);
  return <nav ref={nav} className="production-mobile-toolbar" aria-label="Production navigation" hidden={hidden} style={{ '--toolbar-count': Math.max(1, items.length) } as CSSProperties}>
    <span className="production-toolbar-indicator" aria-hidden="true" />
    {items.map((item, i) => <button key={item.key} type="button" data-toolbar-index={i} data-selected={index === i} aria-current={active === item.key ? 'page' : undefined} disabled={disabled} onClick={() => select.current(i)}>
      <span className="production-toolbar-icon"><item.icon size={19} aria-hidden="true" /></span><span>{item.label}</span>
    </button>)}
  </nav>;
}

export type ToolbarRefreshRequest = { id: number; arrival: Promise<boolean> };
type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'success' | 'error';

export function ProductionRefresh({ onRefresh, blocked, page, request, quietRequestId = 0 }: {
  onRefresh: () => Promise<boolean>;
  blocked: boolean;
  page: string;
  request?: ToolbarRefreshRequest | null;
  quietRequestId?: number;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const latest = useRef({ onRefresh, blocked });
  const startRefresh = useRef<(arrival?: Promise<boolean>) => void>(() => {});
  const [phase, setPhase] = useState<Phase>('idle');
  useLayoutEffect(() => { latest.current = { onRefresh, blocked }; }, [onRefresh, blocked]);
  useEffect(() => {
    const root = slot.current?.closest<HTMLElement>('.workspace-main');
    if (!root) return;
    let disposed = false, busy = false, frame = 0, dismiss = 0;
    document.documentElement.classList.add('has-production-pull-refresh');
    const paint = (distance: number, pulling: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.dataset.pulling = String(pulling);
        root.style.setProperty('--refresh-distance', `${distance}px`);
        root.style.setProperty('--refresh-turn', `${distance * 4}deg`);
      });
    };
    const hide = () => { paint(0, false); setPhase('idle'); delete root.dataset.refreshMode; };
    const refresh = (arrival?: Promise<boolean>) => {
      if (disposed || busy || latest.current.blocked) return;
      window.clearTimeout(dismiss);
      if (arrival) root.dataset.refreshMode = 'toolbar';
      else delete root.dataset.refreshMode;
      busy = true;
      paint(arrival ? 0 : 52, false);
      setPhase('refreshing');
      void (async () => {
        try {
          if (arrival && !await arrival) { if (!disposed) hide(); return; }
          if (disposed) return;
          if (latest.current.blocked) { hide(); return; }
          const ok = await latest.current.onRefresh();
          if (!disposed) { setPhase(ok ? 'success' : 'error'); dismiss = window.setTimeout(hide, ok ? 350 : 2500); }
        } catch {
          if (!disposed) { setPhase('error'); dismiss = window.setTimeout(hide, 2500); }
        } finally { busy = false; }
      })();
    };
    startRefresh.current = refresh;
    setPhase('idle');
    const detach = attachPullToRefresh(root, {
      isBusy: () => busy,
      isBlocked: () => latest.current.blocked,
      onPull: distance => {
        if (disposed) return;
        delete root.dataset.refreshMode;
        window.clearTimeout(dismiss);
        paint(distance, distance > 0);
        setPhase(distance <= 0 ? 'idle' : distance >= PULL_REFRESH_THRESHOLD ? 'ready' : 'pulling');
      },
      onRelease: refresh,
    });
    return () => {
      disposed = true; detach(); cancelAnimationFrame(frame); window.clearTimeout(dismiss);
      root.style.removeProperty('--refresh-distance'); root.style.removeProperty('--refresh-turn');
      delete root.dataset.pulling; delete root.dataset.refreshMode;
      document.documentElement.classList.remove('has-production-pull-refresh');
    };
  }, [page]);
  useEffect(() => { if (request) startRefresh.current(request.arrival); }, [request]);
  useEffect(() => {
    if (!quietRequestId) return;
    // Selecting another section fetches the latest project without a refresh
    // animation. Only a re-tap or a deliberate pull shows the refresh state.
    const frame = requestAnimationFrame(() => {
      if (!latest.current.blocked) void latest.current.onRefresh().catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [quietRequestId]);
  const Icon = phase === 'success' ? Check : phase === 'error' ? WifiOff : phase === 'refreshing' ? RefreshCw : ArrowDown;
  const label = phase === 'ready' ? 'Release to refresh' : phase === 'refreshing' ? 'Refreshing…' : phase === 'success' ? 'Refreshed' : phase === 'error' ? 'Couldn’t refresh. Pull again to retry.' : phase === 'pulling' ? 'Pull to refresh' : '';
  return <div ref={slot} className="production-refresh-slot" data-phase={phase}><div className="production-refresh-indicator" role="status" aria-live="polite" aria-atomic="true"><Icon size={17} aria-hidden="true" /><span>{label}</span></div></div>;
}
