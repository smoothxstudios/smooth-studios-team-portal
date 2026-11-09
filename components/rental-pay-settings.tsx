import { Banknote, Check } from "lucide-react";
import { PersonAvatar } from "@/components/team-profile";
import type { Employee } from "@/lib/dashboard-types";

export function RentalPaySettings({ employees }: { employees: Employee[] }) {
  return <details className="settings-card rental-pay-settings">
    <summary className="settings-disclosure"><span><Banknote size={21} />Rental pay rates</span><span className="settings-disclosure-action">View rates</span></summary>
    <p>Confirmed rates used to calculate rental earnings. Other work is recorded separately.</p>
    <ul>{employees.filter(person => person.accessReady !== false).map(person => {
      const pay = person.compensation;
      const label = pay?.type === "hourly" ? `$${(pay.hourlyCents / 100).toLocaleString("en-US")}/hour` : pay?.type === "commission" ? `${Math.round(pay.rate * 10000) / 100}% per rental` : pay?.type === "pending" ? "Rate needed" : "Sync to see rate";
      return <li key={person.id}><PersonAvatar personId={person.id} name={person.name} /><strong>{person.name}</strong><span>{label}</span>{pay && pay.type !== "pending" && <Check size={16} aria-label="Confirmed" />}</li>;
    })}</ul>
  </details>;
}
