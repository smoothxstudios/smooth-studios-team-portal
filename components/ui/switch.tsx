"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "app-switch peer inline-flex shrink-0 items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0"
      />
    </SwitchPrimitive.Root>
  )
}

function SwitchRow({ children, checked, onCheckedChange, disabled, className }: {
  children: React.ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; className?: string;
}) {
  const id = React.useId()
  return <div className={cn("app-switch-row", className)}><Switch id={id} size="sm" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} /><label htmlFor={id}>{children}</label></div>
}

export { Switch, SwitchRow }
