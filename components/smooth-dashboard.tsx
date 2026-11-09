"use client";
import { DashboardRefreshProvider } from "@/components/dashboard-refresh";
import { LoginScreen } from "@/components/dashboard/login-screen";
import { FeatureBoundary } from "@/components/ui/feature-boundary";
import { PageLoading } from "@/components/ui/page-state";
import { decryptDashboard } from "@/lib/dashboard-crypto";
import { readDashboardData } from "@/lib/dashboard-data-source.mjs";
import { FALLBACK_PROFILES } from "@/lib/dashboard-presentation";
import { attachQuietSnapshotRefresh,createDashboardSnapshotReader,dashboardHasOpenEditor } from "@/lib/dashboard-refresh.mjs";
import type { AccessProfile,DashboardPayload,EncryptedEnvelope } from "@/lib/dashboard-types";
import { attachNotificationMessages } from "@/lib/notification-navigation.mjs";
import { rememberProfile } from "@/lib/quick-sign-in.mjs";
import { disableTeamPush } from "@/lib/team-api";
import { teamToken } from "@/lib/team-auth.mjs";
import dynamic from "next/dynamic";
import { useCallback,useEffect,useRef,useState } from "react";
const DashboardView = dynamic(() => import("@/components/dashboard/dashboard-view"), { loading: PageLoading });

export function SmoothDashboard() {
  useEffect(() => attachNotificationMessages(window), []);
  const [profiles, setProfiles] = useState<AccessProfile[]>(FALLBACK_PROFILES);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [dark, setDark] = useState(false);
  const [sessionPassword, setSessionPassword] = useState("");
  const [schedulingToken, setSchedulingToken] = useState("");
  const sessionEpoch = useRef(0);
  const snapshotReader = useRef<(() => Promise<boolean>) | null>(null);
  const refreshSnapshot = useCallback(() => snapshotReader.current?.() ?? Promise.resolve(false), []);
  const signedIn = Boolean(payload);
  useEffect(() => {
    if (signedIn) {
      if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration(new URL("./", window.location.href).href).then(registration => registration?.update()).catch(() => {});
      return attachQuietSnapshotRefresh(refreshSnapshot);
    }
  }, [signedIn, refreshSnapshot]);

  useEffect(() => {
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("smooth-theme"); } catch { /* Use device appearance when storage is unavailable. */ }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const themeTimer = window.setTimeout(() => setDark(savedTheme ? savedTheme === "dark" : prefersDark), 0);
    return () => window.clearTimeout(themeTimer);
  }, []);

  useEffect(() => {
    if (payload) return;
    const controller = new AbortController();
    let latestRequest = 0;
    const refreshProfiles = async () => {
      const request = ++latestRequest;
      try {
        const data = await readDashboardData("access.json", { signal: controller.signal }) as { profiles: AccessProfile[] };
        if (!controller.signal.aborted && request === latestRequest && Array.isArray(data.profiles) && data.profiles.length) setProfiles(data.profiles);
      } catch { /* Keep the current list when the connection is unavailable. */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refreshProfiles(); };
    void refreshProfiles();
    window.addEventListener("focus", refreshProfiles);
    window.addEventListener("pageshow", refreshProfiles);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refreshProfiles);
      window.removeEventListener("pageshow", refreshProfiles);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [payload]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("smooth-theme", dark ? "dark" : "light"); } catch { /* Appearance still works for this session. */ }
  }, [dark]);

  const unlock = async (profile: AccessProfile, password: string) => {
    const epoch = ++sessionEpoch.current;
    // Load the signed-in interface alongside the encrypted snapshot.
    void import("@/components/dashboard/dashboard-view").catch(() => {});
    const envelope = await readDashboardData(`${profile.id}.json`) as EncryptedEnvelope;
    const unlocked = await decryptDashboard(envelope, password);
    if (unlocked.user.id !== profile.id || unlocked.role !== profile.role) throw new Error("Invalid dashboard payload");
    const token = await teamToken(password, profile.id);
    if (epoch !== sessionEpoch.current) return;
    snapshotReader.current = createDashboardSnapshotReader({
      profile: { id: profile.id, role: profile.role }, password,
      decrypt: decryptDashboard, isCurrent: () => epoch === sessionEpoch.current, onSnapshot: setPayload,
      canApply: () => !dashboardHasOpenEditor(),
    }, unlocked, envelope);
    setSchedulingToken(token);
    setSessionPassword(password);
    rememberProfile(profile.id);
    // Every successful sign-in starts at Home, including saved notification links.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    setPayload(unlocked);
  };

  if (!payload) return <LoginScreen onUnlock={unlock} profiles={profiles} />;
  return <DashboardRefreshProvider><FeatureBoundary><DashboardView dark={dark} onRefresh={refreshSnapshot} onLogout={() => { sessionEpoch.current++; snapshotReader.current = null; void disableTeamPush(schedulingToken).catch(() => {}); setPayload(null); setSessionPassword(""); setSchedulingToken(""); }} payload={payload} sessionPassword={sessionPassword} schedulingToken={schedulingToken} setDark={setDark} /></FeatureBoundary></DashboardRefreshProvider>;
}
