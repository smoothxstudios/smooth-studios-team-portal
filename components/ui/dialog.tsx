"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { SheetHandle } from "@/components/ui/sheet-handle"
import { Button } from "@/components/ui/button"

const DialogActions = React.createContext({ close: () => {} })
function Dialog({ open: controlled, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen)
  const change = (next: boolean) => { if (controlled === undefined) setLocalOpen(next); onOpenChange?.(next) }
  return <DialogActions.Provider value={{ close: () => change(false) }}><DialogPrimitive.Root data-slot="dialog" open={controlled ?? localOpen} onOpenChange={change} {...props} /></DialogActions.Provider>
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeDisabled = false,
  presentation = "dialog",
  onOpenAutoFocus,
  onScroll,
  id: suppliedId,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  closeDisabled?: boolean
  presentation?: "dialog" | "sheet"
}) {
  const actions = React.useContext(DialogActions)
  const generatedId = React.useId()
  const id = suppliedId ?? generatedId
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <div data-slot="dialog-viewport" data-presentation={presentation}>
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-presentation={presentation}
        className={cn(
          "relative grid w-full max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none",
          className
        )}
        {...props}
        onScroll={event => { event.currentTarget.style.setProperty("--dialog-scroll-y", `${event.currentTarget.scrollTop}px`); onScroll?.(event); }}
        id={id}
        data-has-close={showCloseButton || undefined}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          const content = document.getElementById(id)
          const heading = content?.querySelector<HTMLElement>('[data-slot="dialog-title"]')
          if (heading) heading.tabIndex = -1
          ;(heading ?? content)?.focus({ preventScroll: true })
        }}
      >
        {presentation === "sheet" && <SheetHandle disabled={closeDisabled} onDismiss={actions.close} />}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            disabled={closeDisabled}
            className="modal-exit absolute top-2 right-2 z-10 grid size-12 place-items-center rounded-full bg-muted ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-5"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
