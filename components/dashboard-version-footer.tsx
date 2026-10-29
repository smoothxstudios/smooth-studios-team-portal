"use client";

import { useRef, useState } from "react";
import { ChevronDown, History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import history from "@/config/dashboard-releases.json";
import { groupReleaseDays, releaseHistoryForViewer } from "@/lib/dashboard-releases.mjs";

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
  const days = groupReleaseDays(releases);

  return <footer className={`dashboard-version-footer${compact ? " dashboard-version-compact" : ""}`} aria-label="Dashboard version">
    <div className="dashboard-version-meta"><span className="dashboard-version-badge">v{history.currentVersion}</span><span>Updated <time dateTime={latest.date}>{dateLabel(latest.date)}</time></span></div>
    {viewer !== "signed-out" && <Dialog>
      <DialogTrigger asChild><Button type="button" variant="ghost" className="dashboard-version-link"><History size={15} aria-hidden="true" />What changed</Button></DialogTrigger>
      <DialogContent className="dashboard-release-dialog" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus({ preventScroll: true }); }}>
        <DialogHeader>
          <p className="eyebrow">Smooth Studios · v{history.currentVersion}</p>
          <DialogTitle ref={titleRef} tabIndex={-1}>What changed</DialogTitle>
        </DialogHeader>
        <div className="dashboard-release-body" aria-label="Release history" tabIndex={0}>
        {viewer === "owner" && <div className="dashboard-release-owner-tools"><span>{previewEmployee ? "Previewing employee updates" : "Full owner history"}</span><Button type="button" size="sm" variant="outline" onClick={() => { setPreviewEmployee(value => !value); setCategory("all"); setQuery(""); }}>{previewEmployee ? "Back to full history" : "Preview employee updates"}</Button></div>}
        <div className="dashboard-release-filters">
          <label className="dashboard-release-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search update history</span><Input value={query} onChange={event => setQuery(event.target.value)} placeholder={isOwnerView ? "Search all updates" : "Search updates, e.g. schedule"} /></label>
          <label><span className="sr-only">Filter update topic</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All topics</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <p className="dashboard-release-count" role="status">{filtered ? `${days.length} day${days.length === 1 ? "" : "s"} found` : `Updates from ${days.length} day${days.length === 1 ? "" : "s"}`}</p>
        <div className="dashboard-release-list">
          {days.map((day, index) => <details className={`dashboard-release-entry${day.date === latest.date ? " is-current" : ""}`} key={`${day.date}-${query}-${category}-${isOwnerView}`} open={filtered || index === 0}>
            <summary><div><h3><time dateTime={day.date}>{dateLabel(day.date)}</time></h3><div className="dashboard-release-meta"><span>{day.sections.map(section => section.category).join(" · ")}</span>{day.versions.length > 0 && <span className="dashboard-version-badge">{day.versions.includes(history.currentVersion) ? "Current · " : ""}{day.versions.length > 1 ? `v${day.versions[day.versions.length - 1]}–v${day.versions[0]}` : `v${day.versions[0]}`}</span>}</div></div><ChevronDown size={18} aria-hidden="true" /></summary>
            <div className="dashboard-release-day-content">{day.releases.map(release => <section className="dashboard-release-topic dashboard-release-version" key={release.id}><div className="dashboard-release-version-heading">{release.version && <span className="dashboard-version-badge">v{release.version}</span>}<h4>{release.title}</h4></div><p className="dashboard-release-version-category">{release.category}</p><ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul></section>)}</div>
            {day.retrospective && <p className="dashboard-release-retrospective">Includes earlier versions assigned retrospectively from feature milestones.</p>}
          </details>)}
          {!releases.length && <div className="dashboard-release-empty"><p>No updates match this search.</p><Button variant="outline" onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</Button></div>}
        </div>
        </div>
      </DialogContent>
    </Dialog>}
  </footer>;
}
