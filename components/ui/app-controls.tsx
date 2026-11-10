"use client";
import { PersonAvatar } from "@/components/team-profile";

import { Children, Fragment, isValidElement, useId, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select, RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export type AppChoice = { value: string; label: string; description?: string; color?: string; disabled?: boolean };
const encoded = (value: string) => value || "__empty_choice__";

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
function optionText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<OptionProps>(child) ? optionText(child.props.children) : String(child)).join("").replace(/\s+/g, " ").trim();
}
function optionChoices(children: ReactNode): AppChoice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === Fragment) return optionChoices(child.props.children);
    if (child.type !== "option") return [];
    const label = optionText(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }];
  });
}
type AppSelectProps = {
  value: string | number; onValueChange: (value: string) => void; options?: AppChoice[];
  children?: ReactNode; placeholder?: string; disabled?: boolean; required?: boolean;
  id?: string; name?: string; className?: string;
  "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string;
};

/** Shared accessible menu for filters and forms, including existing option declarations. */
export function AppSelect({ value, onValueChange, options: suppliedOptions, children, placeholder = "Choose an option", disabled = false, required = false, id, name, className, ...aria }: AppSelectProps) {
  const options = suppliedOptions ?? optionChoices(children);
  const selected = options.find(option => option.value === String(value));
  return <Select.Root name={name} value={selected && !(required && String(value) === "") ? encoded(String(value)) : ""} onValueChange={next => onValueChange(next === "__empty_choice__" ? "" : next)} disabled={disabled} required={required}>
    <Select.Trigger id={id} className={cn("app-picker-trigger", className)} {...aria}>
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
  </Select.Root>;
}

/** A labelled picker with room for the full booking or person name. */
export function AppPicker({ label, id: suppliedId, ...props }: Omit<AppSelectProps, "children"> & { label: string; options: AppChoice[] }) {
  const generatedId = useId(), id = suppliedId ?? generatedId;
  return <div className="app-field"><label htmlFor={id}>{label}</label><AppSelect {...props} id={id} aria-label={label} /></div>;
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
