import { LoaderCircle } from "lucide-react";
export function PageLoading() {
  return <div className="app-page-state" role="status" aria-live="polite"><LoaderCircle size={20} aria-hidden="true"/><span>Loading…</span></div>;
}
