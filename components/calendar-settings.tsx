"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { CalendarDays, CheckCircle2, Copy, Link2, Unlink, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRefreshSource } from "@/components/dashboard-refresh";
import { teamRequest } from "@/lib/team-api";
import { TEAM, TEAM_API_URL } from "@/lib/team-schedule.mjs";
import { calendarConnectionError } from "@/lib/calendar-connection-errors.mjs";

type CalendarConnection = {
  configured: boolean; connected: boolean; email?: string; ownerConnected: boolean;
  redirectUri: string; configurationReady?: boolean;
  team?: Array<{ id: string; connected: boolean; email?: string }>;
};

export function CalendarSettings({ token, isOwner }: { token: string; isOwner: boolean }) {
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [copied, setCopied] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef(0), lifetime = useRef(0), operation = useRef(false);
  const callback = useRef<string | null>(null);
  const callbackReason = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<CalendarConnection | false> => {
    const id = ++request.current;
    try {
      const next = await teamRequest<CalendarConnection>(token, "/calendar/connection");
      if (id !== request.current) return false;
      setConnection(next); setError("");
      if (callback.current) {
        if (callback.current === "connected" && next.connected) setMessage("Google Calendar connected.");
        else { setMessage(""); setError(calendarConnectionError(callbackReason.current)); }
        callback.current = null; callbackReason.current = null;
      }
      return next;
    } catch {
      if (id === request.current) setError("Couldn’t check Google Calendar. Try again.");
      return false;
    } finally { if (id === request.current) setLoading(false); }
  }, [token]);
  useRefreshSource(refresh);
  useEffect(() => {
    operation.current = false; setBusy(false); setLoading(true); setConnection(null); setCopied(false);
    const url = new URL(window.location.href), result = url.searchParams.get("calendar");
    if (result === "connected" || result === "error") {
      callback.current = result;
      callbackReason.current = url.searchParams.get("calendar_reason");
      url.searchParams.delete("calendar");
      url.searchParams.delete("calendar_reason");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setMessage(result === "connected" ? "Checking your Google Calendar connection…" : "");
    }
    void refresh();
    const update = () => { if (!operation.current && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", update);
    return () => { request.current++; lifetime.current++; window.removeEventListener("focus", update); };
  }, [refresh]);

  const connect = async () => {
    if (operation.current || !connection?.configured || connection.configurationReady === false || (!isOwner && !connection.ownerConnected)) return;
    operation.current = true; setBusy(true); setError(""); setMessage("");
    const current = lifetime.current;
    try {
      const result = await teamRequest<{ authorizationUrl: string }>(token, "/calendar/connect", {});
      if (current !== lifetime.current) return;
      const destination = new URL(result.authorizationUrl), worker = new URL(TEAM_API_URL);
      if (destination.origin !== worker.origin || destination.pathname !== "/calendar/oauth/start" || destination.username || destination.password || destination.hash) throw new Error("Invalid Calendar connection destination.");
      window.location.assign(destination.href);
    } catch { if (current === lifetime.current) setError("Couldn’t start the Google connection. Try again."); }
    finally { if (current === lifetime.current) { operation.current = false; setBusy(false); } }
  };

  const disconnect = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setMessage("");
    const current = lifetime.current;
    try {
      await teamRequest(token, "/calendar/connection", undefined, "DELETE");
      if (current !== lifetime.current) return;
      const next = await refresh();
      if (next && !next.connected) setMessage("Google Calendar disconnected.");
    } catch { if (current === lifetime.current) setError("Couldn’t disconnect Google Calendar. Try again."); }
    finally { if (current === lifetime.current) { operation.current = false; setBusy(false); } }
  };

  const saveSetup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file || !isOwner || operation.current || !connection) { input.value = ""; return; }
    operation.current = true; setBusy(true); setError(""); setMessage("");
    const current = lifetime.current;
    let contents = "";
    let settings: { web?: { client_id?: unknown; client_secret?: unknown; redirect_uris?: unknown } } | undefined;
    try {
      if (file.size > 64 * 1024) throw new Error("Invalid setup file.");
      contents = await file.text();
      settings = JSON.parse(contents);
      const client = settings?.web;
      if (!client || typeof client.client_id !== "string" || !client.client_id.trim() || typeof client.client_secret !== "string" || !client.client_secret.trim() || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(connection.redirectUri)) {
        setError("Choose the downloaded Web application JSON file with the exact redirect URI shown below."); return;
      }
      if (current !== lifetime.current) return;
      await teamRequest(token, "/calendar/setup", settings);
      if (current !== lifetime.current) return;
      const next = await refresh();
      if (next && next.configured) setMessage(next.connected ? "Google setup saved. Your connection is still active." : "Calendar setup saved. Connect Google to finish.");
    } catch { if (current === lifetime.current) setError("Couldn’t save Calendar setup. Check the downloaded Web application JSON file and try again."); }
    finally {
      // Keep the downloaded client credentials out of component state and storage.
      contents = ""; settings = undefined; input.value = "";
      if (current === lifetime.current) { operation.current = false; setBusy(false); }
    }
  };

  const canConnect = connection?.configured && connection.configurationReady !== false && (isOwner || connection.ownerConnected);
  return <section className="settings-card calendar-settings" aria-label="Google Calendar settings">
    <div className="settings-card-heading"><CalendarDays size={23} aria-hidden="true" /><div><h2>Google Calendar</h2><p>{isOwner ? "Send invitations from your Calendar." : "Update your RSVP when you accept or decline in the app."}</p></div></div>
    {loading && <p role="status">Checking connection…</p>}
    {connection && <>
      {connection.connected ? <div className="calendar-connection-state"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>Connected</strong>{connection.email && <p>{connection.email}</p>}</div><Button type="button" variant="ghost" disabled={busy} onClick={() => void disconnect()}><Unlink size={16} aria-hidden="true" />Disconnect</Button></div> : <>
        <p>{!isOwner && (!connection.configured || !connection.ownerConnected) ? "Available after Smooth connects Google Calendar." : connection.configured ? "Choose the Google account you want to use with the dashboard." : "Complete the one-time setup, then connect your Google account."}</p>
        {(isOwner || connection.configured) && <Button type="button" variant="outline" disabled={busy || !canConnect} onClick={() => void connect()}><Link2 size={16} aria-hidden="true" />{busy ? "Working…" : "Connect Google"}</Button>}
      </>}
      {isOwner && connection.configurationReady === false && <p className="calendar-settings-note">Google Calendar connection is unavailable right now. Try again later.</p>}
      {isOwner && <details className="calendar-setup"><summary>{connection.configured ? "Update Google setup" : "Set up Google Calendar"}</summary>{connection.configured && <p className="calendar-settings-note">Replacing the Google client disconnects linked Google accounts. Uploading the same client preserves existing connections.</p>}<ol>
        <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud</a>, choose a project, and enable the Google Calendar API. Set up its OAuth consent screen in Google Auth Platform.</li>
        <li>Under Clients, create an OAuth client with application type <strong>Web application</strong>. Add this exact Authorized redirect URI:</li>
      </ol><div className="calendar-redirect"><code>{connection.redirectUri}</code><Button type="button" variant="outline" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(connection.redirectUri); setCopied(true); } catch { setError("Couldn’t copy. Select the redirect URI and copy it."); } }} aria-label="Copy Google redirect URI"><Copy size={15} aria-hidden="true" />{copied ? "Copied" : "Copy"}</Button></div><ol start={3}>
        <li>Download the client’s JSON file, then upload it below. If the Google app is in Testing, add your account and your team as test users.</li>
        <li>After setup saves, choose <strong>Connect Google</strong>. Team members can then connect their own accounts from Settings.</li>
      </ol><input ref={upload} type="file" accept=".json,application/json" className="sr-only" aria-label="Google Web application OAuth JSON file" disabled={busy || connection.configurationReady === false} onChange={event => void saveSetup(event)} /><Button type="button" variant="outline" disabled={busy || connection.configurationReady === false} onClick={() => upload.current?.click()}><Upload size={16} aria-hidden="true" />{busy ? "Saving…" : connection.configured ? "Replace Google JSON" : "Upload Google JSON"}</Button><a className="calendar-setup-guide" href="https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred" target="_blank" rel="noopener noreferrer">Google setup guide</a></details>}
      {isOwner && Boolean(connection.team?.length) && <details className="calendar-team"><summary>Team connections</summary><ul>{connection.team!.map(person => <li key={person.id}><strong>{TEAM.find(member => member.id === person.id)?.name ?? "Team member"}</strong><span>{person.connected ? person.email || "Connected" : "Not connected"}</span></li>)}</ul></details>}
      <p className="calendar-settings-note">New assignments send real Google Calendar invitations after Smooth connects. Existing assignments won’t be resent.</p>
      <a className="calendar-setup-guide" href="https://dashboard.smoothstudios.co/privacy/" target="_blank" rel="noopener noreferrer">Calendar connection privacy</a>
    </>}
    {message && <p className="calendar-settings-message" role="status">{message}</p>}
    {error && <div className="calendar-settings-error" role="alert"><p>{error}</p><Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}>Check connection</Button></div>}
  </section>;
}
