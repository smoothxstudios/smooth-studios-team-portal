"use client";

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enableQuickSignIn, reconnectQuickSignIn, forgetQuickSignIn, quickSignInError, quickSignInPassword, quickSignInRecord, supportsQuickSignIn } from "@/lib/quick-sign-in.mjs";
import type { AccessProfile } from "@/lib/dashboard-types";

export function QuickSignInSettings({ profile, password }: { profile: AccessProfile; password: string }) {
  const [enabled, setEnabled] = useState(false), [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) setEnabled(Boolean(quickSignInRecord(profile.id))); });
    void supportsQuickSignIn().then(value => { if (active) setSupported(value); });
    return () => { active = false; };
  }, [profile.id]);
  const setup = async (reconnect = false) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await (reconnect ? reconnectQuickSignIn(profile, password) : enableQuickSignIn(profile, password));
      setEnabled(true); setNotice(reconnect ? "Your saved passkey is reconnected in this browser." : "Quick sign-in is set up in this browser.");
    }
    catch (error) { setError(quickSignInError(error)); }
    finally { setBusy(false); }
  };
  const testSignIn = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (await quickSignInPassword(profile.id) !== password) throw new Error("This saved sign-in uses an older password. Reconnect your saved passkey to update it.");
      setNotice("Quick sign-in worked. You’re ready for your next visit.");
    } catch (error) { setError(quickSignInError(error)); }
    finally { setBusy(false); }
  };
  const setupDisabled = busy || supported !== true || !password;
  return <section className="settings-card quick-sign-in-settings">
      <div className="settings-card-heading"><Fingerprint size={23} /><div><h2>Quick sign-in</h2><p>Sign in faster using your device’s existing screen lock.</p></div></div>
      {enabled ? <><p>Quick sign-in is saved in this browser. You can test it before signing out.</p><div className="quick-sign-in-actions"><Button variant="outline" disabled={busy || !password} onClick={testSignIn}>Test quick sign-in</Button><Button disabled={setupDisabled} onClick={() => void setup(true)}>Reconnect saved passkey</Button></div><Button variant="ghost" disabled={busy} onClick={() => { try { forgetQuickSignIn(profile.id); setEnabled(false); setError(""); setNotice(""); } catch { setError("This browser couldn’t remove quick sign-in. Clear this site’s stored data to remove it."); } }}>Remove quick sign-in from this browser</Button></>
        : <><p>{supported === false ? "This browser doesn’t support quick sign-in. Open the dashboard in an up-to-date Safari or Chrome browser, or continue using your password." : "Already saved a passkey for this account? Reconnect it here, or create one for the first time."}</p><div className="quick-sign-in-actions"><Button onClick={() => void setup(true)} disabled={setupDisabled}>Reconnect saved passkey</Button><Button variant="outline" onClick={() => void setup()} disabled={setupDisabled}><Fingerprint size={17} />Create a passkey</Button></div></>}
      {busy && <p role="status">Follow your device’s prompts…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <div className="quick-sign-in-recovery"><p className="login-error" role="alert">{error}</p>{enabled && <Button variant="outline" disabled={setupDisabled} onClick={() => void setup()}>Create a new passkey</Button>}</div>}
      <small>Your password remains available. Set up each browser separately; clearing website data removes its quick sign-in.</small>
  </section>;
}
