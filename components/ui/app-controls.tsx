"use client";
import { PersonAvatar } from "@/components/team-profile";

import { useId, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select, RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export type AppChoice = { value: string; label: string; description?: string; color?: string; disabled?: boolean };
const encoded = (value: string) => value || "__empty_choice__";

/** A keyboard-accessible picker with room for the full booking or person name. */
export function AppPicker({ label, value, onValueChange, options, placeholder = "Choose an option", disabled = false, required = false, id: suppliedId }: {
  label: string; value: string; onValueChange: (value: string) => void; options: AppChoice[]; placeholder?: string; disabled?: boolean; required?: boolean; id?: string;
}) {
  const generatedId = useId(), id = suppliedId ?? generatedId;
  const selected = options.find(option => option.value === value);
  return <div className="app-field"><label htmlFor={id}>{label}</label>
    <Select.Root value={selected ? encoded(value) : ""} onValueChange={next => onValueChange(next === "__empty_choice__" ? "" : next)} disabled={disabled} required={required}>
      <Select.Trigger id={id} className="app-picker-trigger" aria-label={label}>
        {selected?.color && <PersonAvatar personId={selected.value} name={selected.label} color={selected.color} className="app-person-icon" />}
        <span className="app-picker-copy"><Select.Value placeholder={placeholder}>{selected?.label}</Select.Value>{selected?.description && <small>{selected.description}</small>}</span>
        <Select.Icon><ChevronDown size={18} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal><Select.Content position="popper" sideOffset={6} collisionPadding={12} className="app-picker-menu">
        <Select.ScrollUpButton className="app-picker-scroll"><ChevronUp size={16} /></Select.ScrollUpButton>
        <Select.Viewport className="app-picker-options">{options.map(option => <Select.Item key={encoded(option.value)} value={encoded(option.value)} textValue={option.label} disabled={option.disabled} className="app-picker-option">
          {option.color && <PersonAvatar personId={option.value} name={option.label} color={option.color} className="app-person-icon" />}
          <span className="app-picker-copy"><Select.ItemText>{option.label}</Select.ItemText>{option.description && <small>{option.description}</small>}</span>
          <Select.ItemIndicator className="app-picker-check"><Check size={18} /></Select.ItemIndicator>
        </Select.Item>)}</Select.Viewport>
        <Select.ScrollDownButton className="app-picker-scroll"><ChevronDown size={16} /></Select.ScrollDownButton>
      </Select.Content></Select.Portal>
    </Select.Root>
  </div>;
}

/** An explicit acknowledgement, deliberately kept separate from a setting switch. */
export function ConfirmationRow({ checked, onCheckedChange, disabled, children, description, tone = "default" }: {
  checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; children: ReactNode; description?: string; tone?: "default" | "warning";
}) {
  return <label className={cn("app-confirmation", checked && "is-checked")} data-tone={tone} data-disabled={disabled || undefined}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onCheckedChange(event.target.checked)} />
    <span className="app-confirmation-mark" aria-hidden="true"><Check size={16} strokeWidth={3} /></span>
    <span className="app-confirmation-copy"><span>{children}</span>{description && <small>{description}</small>}</span>
  </label>;
}

export function SegmentedControl({ label, value, onValueChange, options, disabled }: {
  label: string; value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return <div className="app-field"><span className="app-field-label">{label}</span><RadioGroup.Root className="app-segments" aria-label={label} value={value} onValueChange={onValueChange} orientation="horizontal" disabled={disabled}>
    {options.map(option => <RadioGroup.Item key={option.value} className="app-segment" value={option.value}>{option.label}</RadioGroup.Item>)}
  </RadioGroup.Root></div>;
}
