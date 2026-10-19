"use client";

import { UnreadBadge } from "@/components/alerts";
import { Button } from "@/components/ui/button";
import {
SidebarGroup,
SidebarGroupContent,
SidebarGroupLabel,
SidebarMenu,
SidebarMenuButton,
SidebarMenuItem,
useSidebar
} from "@/components/ui/sidebar";
import type { ViewKey } from "@/lib/dashboard-presentation";
import {
Bell,
BookOpen,
CalendarCheck,
CalendarClock,
CalendarDays,
ChevronRight,
ClipboardCheck,
ClipboardList,
ExternalLink,
FolderOpen,
House,
LayoutDashboard,
Link2,
Menu,
Settings,
Users,
WalletCards,
X
} from "lucide-react";

export type NavigationGroup = "home" | "work" | "management" | "resources" | "settings";

export type NavigationItem = { key: ViewKey; label: string; icon: typeof LayoutDashboard; group: NavigationGroup; ownerOnly?: boolean };

export const NAV_ITEMS: NavigationItem[] = [
  { key: "overview", label: "Home", icon: House, group: "home" },
  { key: "alerts", label: "Alerts", icon: Bell, group: "home" },
  { key: "planner", label: "Event Planner", icon: Users, group: "work", ownerOnly: true },
  { key: "scheduling", label: "Team Schedule", icon: CalendarDays, group: "work" },
  { key: "availability", label: "Availability", icon: CalendarCheck, group: "work" },
  { key: "creative", label: "Creative Work", icon: ClipboardList, group: "work" },
  { key: "rentals", label: "Appointments", icon: CalendarClock, group: "management", ownerOnly: true },
  { key: "team", label: "Team", icon: Users, group: "management", ownerOnly: true },
  { key: "payouts", label: "Payouts", icon: WalletCards, group: "management" },
  { key: "guide", label: "Studio Guidelines", icon: BookOpen, group: "resources" },
  { key: "checklists", label: "Rental Checklist", icon: ClipboardCheck, group: "resources" },
  { key: "settings", label: "Settings", icon: Settings, group: "settings" },
];

export const EMPLOYEE_NAV_ITEMS: NavigationItem[] = NAV_ITEMS.filter(item => !item.ownerOnly).map(item => ({
  ...item,
  label: item.key === "scheduling" ? "My Schedule" : item.key === "availability" ? "My Availability" : item.key === "payouts" ? "Earnings" : item.label,
  group: item.key === "payouts" ? "work" : item.group,
}));

export function DashboardNavigation({ isOwner, accountId, view, onNavigate, unread }: { unread: number; isOwner: boolean; accountId: string; view: ViewKey; onNavigate: (view: ViewKey) => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileMenu = () => { if (isMobile) setOpenMobile(false); };
  const items = isOwner ? NAV_ITEMS : EMPLOYEE_NAV_ITEMS;
  const groups: { key: NavigationGroup; label: string }[] = [
    { key: "home", label: "Start" },
    { key: "work", label: isOwner ? "Work" : "My work" },
    { key: "management", label: "Management" },
    { key: "resources", label: "Resources" },
  ];

  return <nav aria-label="Dashboard sections" className="studio-navigation">
    {groups.map(group => {
      const groupItems = items.filter(item => item.group === group.key);
      if (!groupItems.length) return null;
      return <SidebarGroup key={group.key} className="studio-nav-group" role="group" aria-label={group.label}>
        {group.key !== "home" && <SidebarGroupLabel asChild className="studio-nav-heading"><h2>{group.label}</h2></SidebarGroupLabel>}
        <SidebarGroupContent><SidebarMenu className="studio-nav">
          {groupItems.map(item => (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton aria-current={view === item.key ? "page" : undefined} isActive={view === item.key}
                onClick={() => { onNavigate(item.key); closeMobileMenu(); }} tooltip={item.label}>
                <item.icon aria-hidden="true" /><span>{item.label}</span>{item.key === "alerts" && <UnreadBadge count={unread} />}
                {view === item.key && <ChevronRight className="sidebar-current-icon" aria-hidden="true" />}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {group.key === "resources" && <>
            <SidebarMenuItem className="studio-connected-start"><SidebarMenuButton asChild tooltip="Productions · opens in a new tab">
              <a href={`https://smooth-studios-production.smoothxstudios.workers.dev/?from=studio&account=${encodeURIComponent(accountId === "owner" ? "smooth" : accountId)}`} target="_blank" rel="noopener noreferrer" onClick={closeMobileMenu} aria-label="Productions (opens in a new tab)" title="Opens in a new tab">
                <Link2 aria-hidden="true" /><span>Productions</span><ExternalLink className="sidebar-external-icon" aria-hidden="true" />
              </a>
            </SidebarMenuButton></SidebarMenuItem>
            <SidebarMenuItem><SidebarMenuButton asChild tooltip="Content Vault · opens in a new tab">
              <a href="https://content.smoothstudios.co/" target="_blank" rel="noopener noreferrer" onClick={closeMobileMenu} aria-label="Content Vault (opens in a new tab)" title="Opens in a new tab">
                <FolderOpen aria-hidden="true" /><span>Content Vault</span><ExternalLink className="sidebar-external-icon" aria-hidden="true" />
              </a>
            </SidebarMenuButton></SidebarMenuItem>
          </>}
        </SidebarMenu></SidebarGroupContent>
      </SidebarGroup>;
    })}
  </nav>;
}

export function MobileMenuButton() {
  const { openMobile, setOpenMobile } = useSidebar();
  return <Button className="mobile-menu-trigger" variant="ghost" size="icon" aria-label="Open navigation menu" aria-expanded={openMobile} onClick={() => setOpenMobile(!openMobile)}><Menu size={22} aria-hidden="true" /></Button>;
}

export function SettingsNavigation({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <nav aria-label="Account settings"><SidebarMenu className="studio-nav studio-settings-nav"><SidebarMenuItem>
    <SidebarMenuButton aria-current={active ? "page" : undefined} isActive={active} tooltip="Settings" onClick={() => { onOpen(); if (isMobile) setOpenMobile(false); }}>
      <Settings aria-hidden="true" /><span>Settings</span>{active && <ChevronRight className="sidebar-current-icon" aria-hidden="true" />}
    </SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu></nav>;
}

export function CloseMobileMenu() {
  const { isMobile, setOpenMobile } = useSidebar();
  return isMobile ? <Button className="mobile-sidebar-close" variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setOpenMobile(false)}><X /></Button> : null;
}
