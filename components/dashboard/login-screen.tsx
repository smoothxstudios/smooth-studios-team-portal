"use client";

import { DashboardVersionFooter } from "@/components/dashboard-version-footer";
import { Logo } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { dashboardBasePath } from "@/lib/site-path.mjs";
import type {
AccessProfile
} from "@/lib/dashboard-types";
import { quickSignInError,quickSignInPassword,quickSignInRecord,rememberedProfile } from "@/lib/quick-sign-in.mjs";
import {
ArrowRight,
ChevronDown,
Eye,
EyeOff,
Fingerprint,
LockKeyhole,
Users
} from "lucide-react";
import { useEffect,useState } from "react";

export function LoginScreen({ profiles, onUnlock, notice }: { notice?: string; profiles: AccessProfile[]; onUnlock: (profile: AccessProfile, password: string) => Promise<void> }) {
  const [selection, setSelection] = useState<{ id: string; quickReady: boolean } | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const selectedId = selection?.id ?? profiles[0]?.id ?? "owner";
  const quickReady = selection?.quickReady ?? false;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const profile = profiles.find(item => item.id === selectedId);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelection(current => {
        const saved = current?.id ?? rememberedProfile();
        const id = saved && profiles.some(item => item.id === saved) ? saved : profiles[0]?.id ?? "owner";
        return { id, quickReady: Boolean(quickSignInRecord(id)) };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profiles]);
  const quickUnlock = async () => {
    if (!profile) return;
    setLoading(true); setError("");
    try {
      const savedPassword = await quickSignInPassword(profile.id);
      try { await onUnlock(profile, savedPassword); }
      catch { throw new Error("Quick sign-in couldn’t open the latest dashboard. Try your password; if it changed, set up quick sign-in again."); }
    } catch (error) { setError(quickSignInError(error)); }
    finally { setLoading(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile || !password) return;
    setLoading(true);
    setError("");
    try {
      await onUnlock(profile, password);
    } catch {
      setError("That password did not unlock this dashboard. Please try again.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <div className="login-card">
        <Logo />
        <div className="login-heading">
          <p className="eyebrow">Dashboard</p>
          <h1>Sign in</h1>
        </div>
        {notice && <p className="login-preparing" role="status">{notice}</p>}
        {!selection ? <p className="login-preparing" role="status">Preparing sign-in…</p> : quickReady && !usePassword ? <><div className="quick-login"><Button disabled={loading} onClick={quickUnlock}><Fingerprint size={20} />{loading ? "Opening…" : `Continue as ${profile?.label ?? selectedId}`}</Button></div>
          {error && <div className="quick-sign-in-recovery"><p className="login-error" role="alert">{error}</p><Button variant="outline" disabled={loading} onClick={() => { setUsePassword(true); setPassword(""); setShowPassword(false); setError(""); }}>Use password</Button></div>}
          <button className="login-account-switch" disabled={loading} onClick={() => { setUsePassword(true); setPassword(""); setShowPassword(false); setError(""); }}>Sign in to another account</button>
        </> : <form onSubmit={submit}>
          <input type="hidden" name="username" autoComplete="username" value={selectedId === "owner" ? "smooth" : selectedId} />
          <label className="select-label" htmlFor="dashboard-profile">Account</label>
          <div className="select-field">
            <Users aria-hidden="true" size={17} />
            <select
              id="dashboard-profile"
              disabled={loading}
              onChange={(event) => { const id = event.target.value; setSelection({ id, quickReady: Boolean(quickSignInRecord(id)) }); setPassword(""); setShowPassword(false); setError(""); }}
              value={selectedId}
            >
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={17} />
          </div>
            <label className="password-label" htmlFor="dashboard-password">Password</label>
            <div className="password-field">
              <LockKeyhole size={17} />
              <input
                autoComplete="current-password"
                id="dashboard-password"
                name="password"
                onChange={(event) => { setPassword(event.target.value); setError(""); }}
                placeholder="Enter your private password"
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} type="button">
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {error && <p className="login-error" role="alert">{error}</p>}
            <Button className="unlock-button" disabled={!password || loading} size="lg" type="submit">
              {loading ? "Signing in…" : "Sign in"}<ArrowRight size={17} />
            </Button>
          {quickReady && <button type="button" className="login-account-switch" disabled={loading} onClick={() => { setUsePassword(false); setPassword(""); setError(""); }}>Use quick sign-in</button>}
        </form>}
        <DashboardVersionFooter compact />
        <a className="calendar-privacy-link" href={`${dashboardBasePath()}/privacy/`}>Calendar connection privacy</a>
      </div>
    </main>
  );
}
