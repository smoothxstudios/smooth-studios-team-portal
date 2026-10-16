"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { helpForRole, searchHelp } from "@/lib/dashboard-help.mjs";

export function DashboardHelp({ isOwner }: { isOwner: boolean }) {
  const [query, setQuery] = useState(""), [category, setCategory] = useState("all");
  const articles = searchHelp(query, isOwner, category);
  const categories = [...new Set(helpForRole(isOwner).map(article => article.category))];
  return <section className="dashboard-help" aria-labelledby="dashboard-help-title">
    <header><h2 id="dashboard-help-title">How can we help?</h2><p>Find a quick answer or learn how to use a feature.</p></header>
    <div className="help-search"><Search size={20} aria-hidden="true" /><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="How do I accept a rental?" aria-label="Search dashboard help" />{query && <button onClick={() => setQuery("")} aria-label="Clear help search"><X size={17} /></button>}</div>
    <div className="help-categories" aria-label="Help topics"><button aria-pressed={category === "all"} onClick={() => setCategory("all")}>All topics</button>{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <p className="help-result-count" role="status">{articles.length} {articles.length === 1 ? "article" : "articles"}{query ? ` matching “${query}”` : ""}</p>
    {articles.length ? <div className="help-articles">{articles.map(item => <details className="help-article" key={`${item.id}:${query ? "search" : "browse"}`}>
      <summary><BookOpen size={18} aria-hidden="true" /><div><small>{item.category}{isOwner && item.role === "employee" ? " · Employee guide" : ""}</small><h3>{item.title}</h3><p>{item.summary}</p></div><ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="help-article-body"><ol>{item.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><small>Updated {new Date(`${item.updated}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</small></div>
    </details>)}</div> : <div className="help-empty"><BookOpen size={28} /><h3>No matching articles yet</h3><p>Try a shorter phrase such as “notifications”, “pay owed”, or “block time”.</p><button onClick={() => { setQuery(""); setCategory("all"); }}>Browse all help</button></div>}
  </section>;
}
