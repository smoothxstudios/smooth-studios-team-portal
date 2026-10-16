"use client";

import { ClipboardCheck, Contact, Moon, Settings, Sun } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { QuickSignInSettings } from "@/components/quick-sign-in-settings";
import { StudioInfoPage } from "@/components/studio-info";
import type { AccessProfile } from "@/lib/dashboard-types";

export type SettingsTab = "preferences" | "reference" | "checklists";

export function DashboardSettings({ token, profile, password, dark, onThemeChange, initialTab = "preferences" }: {
  token: string; profile: AccessProfile; password: string; dark: boolean;
  onThemeChange: (value: boolean) => void; initialTab?: SettingsTab;
}) {
  return <Tabs defaultValue={initialTab} className="dashboard-settings">
    <TabsList className="settings-tabs" aria-label="Settings sections">
      <TabsTrigger value="preferences"><Settings size={17} /><span>Preferences</span></TabsTrigger>
      <TabsTrigger value="reference"><Contact size={17} /><span>Studio info</span></TabsTrigger>
      <TabsTrigger value="checklists"><ClipboardCheck size={17} /><span>Rental checklist</span></TabsTrigger>
    </TabsList>
    <TabsContent value="preferences" className="settings-preferences">
      <QuickSignInSettings profile={profile} password={password} />
      <section className="settings-card settings-appearance"><div><h2>Appearance</h2><p>Choose the look that feels best for you.</p></div><label className="settings-theme"><Sun size={17} /><span>Dark mode</span><Switch checked={dark} onCheckedChange={onThemeChange} aria-label="Dark mode" /><Moon size={17} /></label></section>
    </TabsContent>
    <TabsContent value="reference"><StudioInfoPage token={token} isOwner={profile.role === "owner"} userId={profile.id} section="reference" /></TabsContent>
    <TabsContent value="checklists"><StudioInfoPage token={token} isOwner={profile.role === "owner"} userId={profile.id} section="checklists" /></TabsContent>
  </Tabs>;
}
