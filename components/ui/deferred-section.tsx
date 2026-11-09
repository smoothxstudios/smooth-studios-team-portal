"use client";
import { useState,type ReactNode } from "react";

/** Mount expensive content when first requested; preserve its state on later closes. */
export function DeferredSection({summary,children,className}:{summary:ReactNode;children:ReactNode;className?:string}) {
  const [visited,setVisited]=useState(false);
  return <details className={className} onToggle={event=>{if(event.currentTarget.open)setVisited(true);}}>
    <summary>{summary}</summary>{visited ? children : null}
  </details>;
}
