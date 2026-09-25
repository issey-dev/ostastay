"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "@/components/icons"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ asChild, ...props }: DialogPrimitive.Trigger.Props & { asChild?: boolean }) {
  if (asChild && React.isValidElement(props.children)) {
    return (
      <DialogPrimitive.Trigger
        data-slot="dialog-trigger"
        render={props.children}
        {...props}
        // eslint-disable-next-line react/no-children-prop
        children={undefined}
      />
    )
  }
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-[var(--z-portal)] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// Phones (below `sm`): a dialog is a BOTTOM SHEET — pinned to the bottom edge, at most 92dvh
// tall, its content scrolling inside while the header, footer and close button stay put, and
// clear of the home indicator (safe-area). From `sm` up nothing changes: every class below is
// `max-sm:`-prefixed, so it can never touch tablet/desktop, and the scroll wrapper around the
// children is `sm:contents` (no box), so the children lay out in the popup exactly as before.
// Media-variant utilities are emitted after plain ones, so a caller's unprefixed sizing
// (`max-w-7xl`, `w-[95vw]`, `max-h-[90vh]`) still wins on desktop and loses on a phone.
//
//   mobile="sheet"       (default) bottom sheet, as above
//   mobile="fullscreen"  the whole screen — long forms and wizards
//   mobile="none"        opt out: the caller lays the dialog out itself on every size
const MOBILE_POPUP: Record<"sheet" | "fullscreen", string> = {
  sheet:
    "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:flex max-sm:flex-col max-sm:max-h-[92dvh] max-sm:overflow-hidden max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:data-open:slide-in-from-bottom-8 max-sm:data-closed:slide-out-to-bottom-8",
  fullscreen:
    "max-sm:inset-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:h-dvh max-sm:max-h-none max-sm:flex max-sm:flex-col max-sm:overflow-hidden max-sm:rounded-none max-sm:pt-[max(1rem,env(safe-area-inset-top))] max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
}

// Desktop widths (DESKTOP_PLAN D10: 120 dialogs used 23 widths). New dialogs pick a size;
// an explicit `sm:max-w-*` in className still wins (it comes later), so existing callers keep
// their width until they are moved over.
const DESKTOP_SIZE: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "sm:max-w-[425px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[720px]",
  xl: "sm:max-w-[960px]",
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  mobile = "sheet",
  size,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  mobile?: "sheet" | "fullscreen" | "none"
  /** Desktop width: sm 425 · md 560 · lg 720 · xl 960. Anything wider is a page or a Sheet. */
  size?: "sm" | "md" | "lg" | "xl"
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-mobile={mobile}
        className={cn(
          "fixed top-1/2 left-1/2 z-[var(--z-portal)] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // Desktop: never taller than the window — a long form scrolls inside the dialog
          // instead of pushing Save below a 768px laptop screen (98 of 120 dialogs set no
          // max-height). A caller's own max-h-* still wins.
          "sm:max-h-[calc(100dvh-2rem)] sm:overflow-y-auto",
          size && DESKTOP_SIZE[size],
          className,
          mobile !== "none" && MOBILE_POPUP[mobile]
        )}
        {...props}
      >
        {mobile === "none" ? (
          children
        ) : (
          <div
            data-slot="dialog-scroll"
            className="max-sm:-mx-4 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:gap-4 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:px-4 sm:contents"
          >
            {children}
          </div>
        )}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      // Phone sheet: the title stays at the top while the body scrolls under it; room on
      // the right for the close button.
      className={cn(
        "flex flex-col gap-2 max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:-mt-px max-sm:bg-popover max-sm:pt-px max-sm:pr-8 max-sm:pb-2",
        className
      )}
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
        "flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end",
        // Phone sheet: the primary action never scrolls away.
        "max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:mt-auto max-sm:border-t max-sm:border-border max-sm:bg-popover max-sm:pt-3",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
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
