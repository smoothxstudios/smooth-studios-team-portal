"use client";

import { useRef, useState } from "react";
import { ChevronDown, History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import history from "@/config/dashboard-releases.json";
import { releaseHistoryForViewer } from "@/lib/dashboard-releases.mjs";

const latest = history.releases[0];
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const searchable = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

export function DashboardVersionFooter({ compact = false, viewer = "signed-out" }: { compact?: boolean; viewer?: "owner" | "employee" | "signed-out" }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [previewEmployee, setPreviewEmployee] = useState(false);
  const isOwnerView = viewer === "owner" && !previewEmployee;
  const visibleHistory = releaseHistoryForViewer(history.releases, isOwnerView ? "owner" : viewer === "signed-out" ? "signed-out" : "employee");
  const categories = [...new Set(visibleHistory.map(release => release.category))].sort();
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  const filtered = terms.length > 0 || category !== "all";
  const releases = visibleHistory.filter(release => {
    const text = searchable([release.title, release.category, release.date, dateLabel(release.date), release.version ?? "", ...release.changes].join(" "));
    return (category === "all" || release.category === category) && terms.every(term => text.includes(term));
  });

  return <footer className={`dashboard-version-footer${compact ? " dashboard-version-compact" : ""}`} aria-label="Dashboard version">
    <div className="dashboard-version-meta"><span className="dashboard-version-badge">v{history.currentVersion}</span><span>Updated <time dateTime={latest.date}>{dateLabel(latest.date)}</time></span></div>
    {viewer !== "signed-out" && <Dialog>
      <DialogTrigger asChild><Button type="button" variant="ghost" className="dashboard-version-link"><History size={15} aria-hidden="true" />What changed</Button></DialogTrigger>
      <DialogContent className="dashboard-release-dialog" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
        <DialogHeader>
          <p className="eyebrow">Smooth Studios · v{history.currentVersion}</p>
          <DialogTitle ref={titleRef} tabIndex={-1}>What changed</DialogTitle>
          <DialogDescription>{isOwnerView ? "Your full history, including administrative and behind-the-scenes changes." : "Design improvements and updates to the tools you use."} Earlier version labels were assigned retrospectively from feature milestones. Dates use Eastern time.</DialogDescription>
        </DialogHeader>
        {viewer === "owner" && <div className="dashboard-release-owner-tools"><span>{previewEmployee ? "Previewing employee updates" : "Full owner history"}</span><Button type="button" size="sm" variant="outline" onClick={() => { setPreviewEmployee(value => !value); setCategory("all"); setQuery(""); }}>{previewEmployee ? "Back to full history" : "Preview employee updates"}</Button></div>}
        <div className="dashboard-release-filters">
          <label className="dashboard-release-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search update history</span><Input value={query} onChange={event => setQuery(event.target.value)} placeholder={isOwnerView ? "Search all updates" : "Search updates, e.g. schedule"} /></label>
          <label><span className="sr-only">Filter update topic</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All topics</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <p className="dashboard-release-count" role="status">{releases.length} update{releases.length === 1 ? "" : "s"}{filtered ? " found" : " · Aug 2026–present"}</p>
        <div className="dashboard-release-list" aria-label="Release history" tabIndex={0}>
          {releases.map(release => <details className={`dashboard-release-entry${release.id === latest.id ? " is-current" : ""}`} key={`${release.id}-${filtered}`} open={filtered || release.id === latest.id}>
            <summary><div><div className="dashboard-release-meta"><time dateTime={release.date}>{dateLabel(release.date)}</time><span>{release.category}</span>{release.version && <span className="dashboard-version-badge">{release.id === latest.id ? "Current · " : ""}v{release.version}{release.retrospective ? " · retrospective" : ""}</span>}{isOwnerView && !release.employee && <span>Owner update</span>}</div><h3>{release.title}</h3></div><ChevronDown size={18} aria-hidden="true" /></summary>
            <ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul>
          </details>)}
          {!releases.length && <div className="dashboard-release-empty"><p>No updates match this search.</p><Button variant="outline" onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</Button></div>}
        </div>
      </DialogContent>
    </Dialog>}
  </footer>;
}
