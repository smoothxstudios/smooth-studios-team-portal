"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Banknote, Bell, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Contact, Fingerprint, KeyRound, Moon, PanelLeft, RefreshCw, Search, UserRound, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar } from "@/components/team-profile";
import type { AccessProfile, DashboardPayload, Employee } from "@/lib/dashboard-types";

function SettingsLoading() { return <p className="settings-loading" role="status">Loading settings…</p>; }
const ProfileSettings = dynamic(() => import("@/components/profile-settings").then(module => module.ProfileSettings), { loading: SettingsLoading });
const RentalPaySettings = dynamic(() => import("@/components/rental-pay-settings").then(module => module.RentalPaySettings), { loading: SettingsLoading });
const NotificationSettings = dynamic(() => import("@/components/notification-settings").then(module => module.NotificationSettings), { loading: SettingsLoading });
const QuickSignInSettings = dynamic(() => import("@/components/quick-sign-in-settings").then(module => module.QuickSignInSettings), { loading: SettingsLoading });
const DashboardHelp = dynamic(() => import("@/components/dashboard-help").then(module => module.DashboardHelp), { loading: SettingsLoading });
const StudioInfoPage = dynamic(() => import("@/components/studio-info").then(module => module.StudioInfoPage), { loading: SettingsLoading });
const AppleCalendarSettings = dynamic(() => import("@/components/apple-calendar-settings").then(module => module.AppleCalendarSettings), { loading: SettingsLoading });
const CalendarSettings = dynamic(() => import("@/components/calendar-settings").then(module => module.CalendarSettings), { loading: SettingsLoading });
const TeamLoginSettings = dynamic(() => import("@/components/team-login-settings").then(module => module.TeamLoginSettings), { loading: SettingsLoading });

export type SettingsTab = "preferences" | "reference" | "help";
type SettingId = "profile" | "notifications" | "signin" | "rates" | "logins" | "google" | "apple" | "sync" | "reference" | "help";
type Row = { id: SettingId | "dark" | "planner"; label: string; icon: LucideIcon; keywords: string; owner?: boolean };
const groups: { title: string; rows: Row[] }[] = [
  { title: "Personal", rows: [
    { id: "profile", label: "Your icon", icon: UserRound, keywords: "profile photo picture avatar initials color name" },
    { id: "dark", label: "Dark mode", icon: Moon, keywords: "appearance theme light display" },
    { id: "notifications", label: "Notifications", icon: Bell, keywords: "alerts push permission device delivery" },
    { id: "signin", label: "Quick sign-in", icon: Fingerprint, keywords: "account security passkey face id touch login password" },
  ] },
  { title: "Studio", rows: [
    { id: "rates", label: "Rental pay rates", icon: Banknote, keywords: "team hourly wages compensation confirm employees", owner: true },
    { id: "logins", label: "Team logins", icon: KeyRound, keywords: "accounts password staff employees access", owner: true },
    { id: "planner", label: "Event Planner", icon: PanelLeft, keywords: "sidebar optional tools show hide", owner: true },
  ] },
  { title: "Connections", rows: [
    { id: "google", label: "Google Calendar", icon: CalendarDays, keywords: "connect invitations rsvp account sync" },
    { id: "apple", label: "Apple Calendar", icon: CalendarDays, keywords: "iphone subscription ics feed calendar sync" },
    { id: "sync", label: "Data sync", icon: RefreshCw, keywords: "refresh calendar stripe update import appointments", owner: true },
  ] },
  { title: "Support", rows: [
    { id: "reference", label: "Studio info", icon: Contact, keywords: "contacts access wifi wi-fi information" },
    { id: "help", label: "Help", icon: CircleHelp, keywords: "guide instructions questions how support" },
  ] },
];

export function DashboardSettings({ token, profile, password, dark, onThemeChange, onSync, lastSynced, employees = [], teamAccess, initialTab = "preferences", plannerEnabled = false, onPlannerChange }: {
  plannerEnabled?: boolean; onPlannerChange?: (enabled: boolean) => void;
  token: string; profile: AccessProfile; password: string; dark: boolean;
  onThemeChange: (value: boolean) => void; initialTab?: SettingsTab;
  onSync?: () => void; lastSynced?: string;
  employees?: Employee[]; teamAccess?: DashboardPayload["teamAccess"];
}) {
  const isOwner = profile.role === "owner";
  const initial = initialTab === "preferences" ? null : initialTab;
  const [active, setActive] = useState<SettingId | null>(initial);
  const [visited, setVisited] = useState<SettingId[]>(initial ? [initial] : []);
  const [query, setQuery] = useState("");
  const index = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null);
  const indexScroll = useRef(0), lastRow = useRef<SettingId | null>(initial), focusPending = useRef(false);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const available = groups.map(group => ({ ...group, rows: group.rows.filter(row => (!row.owner || isOwner) && (row.id !== "planner" || onPlannerChange) && (row.id !== "sync" || onSync)) }));
  const matching = available.map(group => ({ ...group, rows: group.rows.filter(row => terms.every(term => `${group.title} ${row.label} ${row.keywords}`.toLowerCase().includes(term))) })).filter(group => group.rows.length);
  const allowed = new Set(available.flatMap(group => group.rows.map(row => row.id)));
  const current = active && allowed.has(active) ? active : null;

  const open = (id: SettingId) => {
    indexScroll.current = window.scrollY; lastRow.current = id; focusPending.current = true;
    setVisited(previous => previous.includes(id) ? previous : [...previous, id]); setActive(id);
  };
  useEffect(() => {
    // OAuth returns must still open their result after connection controls became on-demand.
    const result = new URL(window.location.href).searchParams.get("calendar");
    if (result === "connected" || result === "error") {
      lastRow.current = "google"; focusPending.current = true;
      setVisited(previous => previous.includes("google") ? previous : [...previous, "google"]); setActive("google");
    }
  }, []);
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    if (current) { window.scrollTo({ top: 0, behavior: "instant" }); back.current?.focus({ preventScroll: true }); }
    else {
      window.scrollTo({ top: indexScroll.current, behavior: "instant" });
      index.current?.querySelector<HTMLButtonElement>(`[data-setting="${lastRow.current}"]`)?.focus({ preventScroll: true });
    }
  }, [current]);

  return <div className="dashboard-settings settings-organized">
    <div ref={index} className="settings-index" hidden={current !== null}>
      <div className="settings-search"><Search size={19} aria-hidden="true" /><Input type="search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear settings search" onClick={() => setQuery("")}><X size={17} /></button>}</div>
      <div className="settings-groups">{matching.map(group => <section className="settings-group" key={group.title} aria-labelledby={`settings-group-${group.title}`}>
        <h2 id={`settings-group-${group.title}`}>{group.title}</h2>
        <div className="settings-group-rows">{group.rows.map(row => {
          const Icon = row.icon;
          const icon = row.id === "profile" ? <PersonAvatar personId={profile.id} name={profile.label} /> : <span className="settings-row-icon"><Icon size={20} aria-hidden="true" /></span>;
          if (row.id === "dark" || row.id === "planner") {
            const enabled = row.id === "dark" ? dark : plannerEnabled;
            return <div className="settings-row settings-toggle-row" key={row.id}>
              {icon}<label className="settings-row-copy" htmlFor={`setting-${row.id}`}><span>{row.label}</span>{row.id === "planner" && <small>Show in sidebar</small>}</label>
              <Switch id={`setting-${row.id}`} checked={enabled} onCheckedChange={row.id === "dark" ? onThemeChange : onPlannerChange} aria-label={row.id === "planner" ? "Show Event Planner" : "Dark mode"} />
            </div>;
          }
          const id = row.id;
          return <button type="button" key={id} data-setting={id} className="settings-row settings-link" onClick={() => open(id)}>
            {icon}<span className="settings-row-copy"><span>{row.label}</span></span><ChevronRight size={17} className="settings-row-chevron" aria-hidden="true" />
          </button>;
        })}</div>
      </section>)}</div>
      {!matching.length && <div className="settings-empty" role="status"><p>No settings found.</p><Button variant="outline" onClick={() => setQuery("")}>Clear search</Button></div>}
    </div>
    <div className="settings-detail-nav" hidden={current === null}><Button ref={back} variant="outline" onClick={() => { focusPending.current = true; setActive(null); }} aria-label="Back to settings"><ChevronLeft size={17} />Settings</Button></div>
    {/* Mount on first visit, then retain local drafts and search when moving back. */}
    {visited.filter(id => allowed.has(id)).map(id => <div className="settings-detail" key={id} hidden={current !== id}>
      {id === "profile" && <ProfileSettings userId={profile.id} name={profile.label} />}
      {id === "notifications" && <NotificationSettings token={token} isOwner={isOwner} />}
      {id === "signin" && <QuickSignInSettings profile={profile} password={password} />}
      {id === "rates" && isOwner && <RentalPaySettings employees={employees} />}
      {id === "logins" && isOwner && <TeamLoginSettings employees={employees} access={teamAccess} />}
      {id === "google" && <CalendarSettings token={token} isOwner={isOwner} />}
      {id === "apple" && <AppleCalendarSettings token={token} isOwner={isOwner} />}
      {id === "sync" && isOwner && onSync && <section className="settings-card settings-sync"><div className="settings-card-heading"><RefreshCw size={23} /><div><h2>Data sync</h2>{lastSynced && <p>Updated {lastSynced}</p>}</div></div><Button variant="outline" onClick={onSync}><RefreshCw size={17} />Sync now</Button></section>}
      {id === "reference" && <StudioInfoPage token={token} isOwner={isOwner} userId={profile.id} section="reference" />}
      {id === "help" && <DashboardHelp isOwner={isOwner} />}
    </div>)}
  </div>;
}
