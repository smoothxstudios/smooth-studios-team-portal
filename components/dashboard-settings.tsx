"use client";

import { Contact, CircleHelp, Moon, RefreshCw, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { NotificationSettings } from "@/components/notification-settings";
import { QuickSignInSettings } from "@/components/quick-sign-in-settings";
import { DashboardHelp } from "@/components/dashboard-help";
import { StudioInfoPage } from "@/components/studio-info";
import { CalendarSettings } from "@/components/calendar-settings";
import type { AccessProfile } from "@/lib/dashboard-types";

export type SettingsTab = "preferences" | "reference" | "help";

export function DashboardSettings({ token, profile, password, dark, onThemeChange, onSync, lastSynced, initialTab = "preferences" }: {
  token: string; profile: AccessProfile; password: string; dark: boolean;
  onThemeChange: (value: boolean) => void; initialTab?: SettingsTab;
  onSync?: () => void; lastSynced?: string;
}) {
  return <Tabs defaultValue={initialTab} className="dashboard-settings">
    <TabsList className="settings-tabs" aria-label="Settings sections">
      <TabsTrigger value="preferences"><Settings size={17} /><span>Preferences</span></TabsTrigger>
      <TabsTrigger value="reference"><Contact size={17} /><span>Studio info</span></TabsTrigger>
      <TabsTrigger value="help"><CircleHelp size={17} /><span>Help</span></TabsTrigger>
    </TabsList>
    <TabsContent value="preferences" className="settings-preferences">
      {profile.role === "owner" && onSync && <section className="settings-card settings-sync"><div className="settings-card-heading"><RefreshCw size={23} /><div><h2>Data sync</h2>{lastSynced && <p>Updated {lastSynced}</p>}</div></div><Button variant="outline" onClick={onSync}><RefreshCw size={17} />Sync now</Button></section>}
      <CalendarSettings token={token} isOwner={profile.role === "owner"} />
      <NotificationSettings token={token} isOwner={profile.role === "owner"} />
      <QuickSignInSettings profile={profile} password={password} />
      <section className="settings-card settings-appearance"><div><h2>Appearance</h2><p>Choose the look that feels best for you.</p></div><label className="settings-theme"><Sun size={17} /><span>Dark mode</span><Switch checked={dark} onCheckedChange={onThemeChange} aria-label="Dark mode" /><Moon size={17} /></label></section>
    </TabsContent>
    <TabsContent value="reference"><StudioInfoPage token={token} isOwner={profile.role === "owner"} userId={profile.id} section="reference" /></TabsContent>
    <TabsContent value="help"><DashboardHelp isOwner={profile.role === "owner"} /></TabsContent>
  </Tabs>;
}
