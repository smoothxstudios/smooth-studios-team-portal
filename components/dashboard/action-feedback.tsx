"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";

// The confirmation stays visible when a successful save closes its form.
export function ActionFeedback() {
  const [notice, setNotice] = useState<{ phase: string; message: string } | null>(null);
  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const { id, phase } = (event as CustomEvent<{ id: string; phase: string }>).detail;
      clearTimeout(timer);
      if (phase === "saving") pending.add(id); else pending.delete(id);
      if (pending.size) setNotice({ phase: "saving", message: "Saving…" });
      else if (phase === "saved") {
        setNotice({ phase, message: "Saved" });
        timer = setTimeout(() => setNotice(null), 3500);
      } else setNotice(null); // The originating form keeps its error and retry controls.
    };
    window.addEventListener("smooth-action-feedback", receive);
    return () => { window.removeEventListener("smooth-action-feedback", receive); clearTimeout(timer); };
  }, []);
  return <div className="action-feedback-region" role="status" aria-live="polite" aria-atomic="true">{notice && <div className="action-feedback">{notice.phase === "saving" ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}<span>{notice.message}</span>{notice.phase !== "saving" && <button aria-label="Dismiss confirmation" onClick={() => setNotice(null)}><X size={17} /></button>}</div>}</div>;
}
