"use client";

import { useRef, useState } from "react";
import { Camera, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar, useTeamProfiles, type TeamProfile } from "@/components/team-profile";
import { TEAM } from "@/lib/team-schedule.mjs";

const iconColors = [
  ["Red", "#df2028"], ["Orange", "#b76b15"], ["Gold", "#8a6d13"],
  ["Green", "#25825d"], ["Teal", "#167d8d"], ["Blue", "#2563eb"],
  ["Purple", "#8257bc"], ["Pink", "#bd3178"], ["Graphite", "#4b5563"],
];
function defaultColor(userId: string) {
  const color = TEAM.find(person => person.id === userId)?.color ?? "#64748b";
  return color.startsWith("#") ? color : "#" + (color.match(/\d+/g) ?? ["100", "116", "139"]).map(value => Number(value).toString(16).padStart(2, "0")).join("");
}

async function preparePhoto(file: File) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size > 12_000_000) throw new Error("Choose a photo smaller than 12 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error("This photo couldn’t open. Try a JPG, PNG, or WebP image."); }
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Your browser couldn’t prepare the photo.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const photo = canvas.toDataURL("image/jpeg", .82);
    if (photo.length > 100_000) throw new Error("Choose a smaller photo.");
    return photo;
  } finally { URL.revokeObjectURL(url); }
}

export function ProfileSettings({ userId, name }: { userId: string; name: string }) {
  const state = useTeamProfiles();
  const [draft, setDraft] = useState<TeamProfile | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null), operation = useRef(0);
  if (!state) return null;
  const saved: TeamProfile = state.profiles[userId] ?? { userId, mode: "initial", photo: null, revision: 0 };
  const current = draft ?? saved;
  const chosenColor = current.color ?? defaultColor(userId);
  const chosenInitial = current.initial ?? name.slice(0, 1).toUpperCase();
  const validInitial = /^[\p{L}\p{N}]{1,2}$/u.test(chosenInitial);
  const customize = (values: Partial<TeamProfile>) => { setNotice(""); setError(""); setDraft({ ...current, ...values }); };
  const choose = (mode: "initial" | "photo") => { setNotice(""); setDraft({ ...current, mode }); };
  return <section className="settings-card profile-settings">
    <div className="settings-card-heading"><UserRound size={23} /><div><h2>Your icon</h2><p>Use your color and initial or a photo throughout the dashboard.</p></div></div>
    {state.error ? <p role="alert">{state.error} <Button variant="outline" onClick={() => void state.refresh()}>Try again</Button></p> : <>
      <div className="profile-icon-preview">{current.mode === "photo" && current.photo ? <img src={current.photo} alt="Your icon preview" /> : <PersonAvatar personId={userId} name={name} color={chosenColor} initial={chosenInitial || name.slice(0, 1)} initialOnly className="profile-initial-preview" />}<div className="profile-icon-options" role="group" aria-label="Icon style"><Button variant={current.mode === "initial" ? "default" : "outline"} aria-pressed={current.mode === "initial"} disabled={busy || state.loading} onClick={() => choose("initial")}>Color &amp; initial</Button><Button variant={current.mode === "photo" ? "default" : "outline"} aria-pressed={current.mode === "photo"} disabled={busy || state.loading} onClick={() => current.photo ? choose("photo") : file.current?.click()}>Photo</Button></div></div>
      {current.mode === "initial" && <fieldset className="profile-customization" disabled={busy || state.loading}>
        <legend>Customize your icon</legend>
        <label className="profile-initial-field">Initial<input aria-label="Icon initial" maxLength={2} value={chosenInitial} onChange={event => customize({ initial: event.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} /><small>One or two letters or numbers.</small></label>
        <div className="profile-color-field"><span>Color</span><div className="profile-color-choices" role="group" aria-label="Icon color">{iconColors.map(([label, color]) => <button key={color} type="button" className="profile-color-swatch" aria-label={label} aria-pressed={chosenColor.toLowerCase() === color} style={{ "--swatch": color } as React.CSSProperties} onClick={() => customize({ color })} />)}<label className="profile-custom-color">Custom<input type="color" aria-label="Custom icon color" value={chosenColor} onChange={event => customize({ color: event.target.value })} /></label></div></div>
        <Button variant="ghost" onClick={() => customize({ color: null, initial: null })}>Use default icon</Button>
      </fieldset>}
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" aria-label="Choose profile photo" disabled={busy || state.loading} onChange={async event => { const selected = event.target.files?.[0]; event.target.value = ""; if (!selected) return; const id = ++operation.current; setBusy(true); setError(""); setNotice(""); try { const photo = await preparePhoto(selected); if (id === operation.current) setDraft({ ...current, mode: "photo", photo }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t open this photo."); } finally { setBusy(false); } }} />
      <div className="profile-icon-actions"><Button variant="outline" disabled={busy || state.loading} onClick={() => file.current?.click()}><Camera size={16} />{current.photo ? "Change photo" : "Choose photo"}</Button>{current.photo && <Button variant="ghost" disabled={busy} onClick={() => { setDraft({ ...current, mode: "initial", photo: null }); setNotice(""); }}>Remove photo</Button>}{draft && <><Button disabled={busy || !validInitial} onClick={async () => { setBusy(true); setError(""); try { await state.save(current); setDraft(null); setNotice("Icon saved."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t save your icon."); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save icon"}</Button><Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Cancel</Button></>}</div>
      {state.loading && <p role="status">Loading your icon…</p>}{notice && <p role="status">{notice}</p>}{error && <p className="login-error" role="alert">{error} <button type="button" onClick={async () => { if (await state.refresh()) { setDraft(null); setError(""); } }}>Reload profile</button></p>}
    </>}
  </section>;
}
