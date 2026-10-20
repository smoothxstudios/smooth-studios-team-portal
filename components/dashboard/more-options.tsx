"use client";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function MoreOptions({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  return <details className="form-more-options" open={defaultOpen || undefined}><summary>More options<ChevronDown size={17} aria-hidden="true" /></summary><div>{children}</div></details>;
}
