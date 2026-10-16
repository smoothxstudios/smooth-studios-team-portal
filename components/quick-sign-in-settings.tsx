"use client";

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enableQuickSignIn, forgetQuickSignIn, quickSignInError, quickSignInRecord, supportsQuickSignIn } from "@/lib/quick-sign-in.mjs";
import type { AccessProfile } from "@/lib/dashboard-types";

export function QuickSignInSettings({ profile, password }: { profile: AccessProfile; password: string }) {
  const [enabled, setEnabled] = useState(false), [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) setEnabled(Boolean(quickSignInRecord(profile.id))); });
    void supportsQuickSignIn().then(value => { if (active) setSupported(value); });
    return () => { active = false; };
  }, [profile.id]);
  const enable = async () => {
    setBusy(true); setError("");
    try { await enableQuickSignIn(profile, password); setEnabled(true); }
    catch (error) { setError(quickSignInError(error)); }
    finally { setBusy(false); }
  };
  return <section className="settings-card quick-sign-in-settings">
      <div className="settings-card-heading"><Fingerprint size={23} /><div><h2>Quick sign-in</h2><p>Sign in faster using your device’s existing screen lock.</p></div></div>
      {enabled ? <><p role="status">Quick sign-in is ready in this browser. Next time, choose <strong>Continue as {profile.label}</strong>.</p><Button variant="outline" disabled={busy} onClick={() => { try { forgetQuickSignIn(profile.id); setEnabled(false); } catch { setError("This browser couldn’t remove quick sign-in. Clear this site’s stored data to remove it."); } }}>Remove quick sign-in from this browser</Button></>
        : <><p>{supported === false ? "This browser doesn’t support quick sign-in. Open the dashboard in an up-to-date Safari or Chrome browser, or continue using your password." : "Sign in once with your password to set this up. Your device may ask you to confirm twice."}</p><Button onClick={enable} disabled={busy || supported !== true || !password}><Fingerprint size={17} />{busy ? "Follow your device’s prompts…" : "Set up quick sign-in"}</Button></>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <small>Your password remains available. Set up each browser separately; clearing website data removes its quick sign-in.</small>
  </section>;
}
