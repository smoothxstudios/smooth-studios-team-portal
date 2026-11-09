"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { teamRequest } from "@/lib/team-api";
import { TEAM } from "@/lib/team-schedule.mjs";
import { useRefreshSource } from "@/components/dashboard-refresh";

export type TeamProfile = { userId: string; mode: "initial" | "photo"; photo: string | null; revision: number };
type ProfilesContext = { profiles: Record<string, TeamProfile>; loading: boolean; error: string; refresh: () => Promise<boolean>; save: (profile: TeamProfile) => Promise<void> };
const ProfileContext = createContext<ProfilesContext | null>(null);
export const useTeamProfiles = () => useContext(ProfileContext);

export function TeamProfilesProvider({ token, userId, children }: { token: string; userId: string; children: ReactNode }) {
  const [profiles, setProfiles] = useState<Record<string, TeamProfile>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const sequence = useRef(0), saving = useRef(false);
  const refresh = useCallback(async () => {
    if (saving.current) return false;
    const id = ++sequence.current;
    try {
      const result = await teamRequest<{ profiles: TeamProfile[] }>(token, "/team-profiles");
      if (id !== sequence.current) return false;
      setProfiles(Object.fromEntries(result.profiles.map(profile => [profile.userId, profile]))); setError(""); return true;
    } catch { if (id === sequence.current) setError("Your profile couldn’t load. Try again."); return false; }
    finally { if (id === sequence.current) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh]);
  const save = async (profile: TeamProfile) => {
    if (saving.current) return;
    saving.current = true; const id = ++sequence.current;
    try {
      const saved = await teamRequest<TeamProfile>(token, "/team-profiles", { ...profile, userId }, "PUT");
      if (id === sequence.current) { setProfiles(previous => ({ ...previous, [userId]: saved })); setError(""); }
    } finally { saving.current = false; }
  };
  return <ProfileContext.Provider value={{ profiles, loading, error, refresh, save }}>{children}</ProfileContext.Provider>;
}

export function PersonAvatar({ personId, name, color, className = "", initialOnly = false, children }: { personId: string; name?: string; color?: string; className?: string; initialOnly?: boolean; children?: ReactNode }) {
  const person = TEAM.find(person => person.id === personId);
  const profile = useTeamProfiles()?.profiles[personId];
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photo = !initialOnly && profile?.mode === "photo" && profile.photo !== failedPhoto ? profile.photo : null;
  const accent = color ?? person?.color ?? "#64748b";
  return <span className={`person-avatar ${className}`} style={{ "--person-accent": accent, color: `var(--person-ink, ${accent})`, background: `color-mix(in srgb, ${accent} 12%, var(--card))` } as CSSProperties} aria-label={name ?? person?.name ?? "Team member"}>
    {photo ? <img src={photo} alt="" onError={() => setFailedPhoto(photo)} /> : (name ?? person?.name ?? personId).slice(0, 1).toUpperCase()}{children}
  </span>;
}
