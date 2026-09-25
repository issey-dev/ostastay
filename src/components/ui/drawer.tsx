"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"

// ─── Drawer: a swipe-down bottom sheet for phones ───────────────────────────
// Built on base-ui's Drawer (already a dependency; no new package). Used where a phone
// needs a picker or a short action list that a popover can't hold: SearchableSelect and the
// date pickers switch to it below `md` (see .agents/docs/MOBILE_PLAN.md §4 item 3).
//
// Shape: grab handle + optional header, a scrolling body, an optional sticky footer, all
// clear of the home indicator. Swiping down (or tapping the backdrop) closes it. Wrapped in
// VirtualKeyboardProvider so a focused search box stays above the on-screen keyboard.
//
// The popup extends `--bleed` below the screen so a slightly-too-far swipe up never shows
// a gap under it (the base-ui recipe).

function Drawer({ swipeDirection = "down", ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" swipeDirection={swipeDirection} {...props} />
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerContent({
  className,
  children,
  initialFocus,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop
          data-slot="drawer-backdrop"
          className="fixed inset-0 z-[var(--z-portal)] min-h-dvh bg-black/40 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute"
        />
        <DrawerPrimitive.Viewport
          data-slot="drawer-viewport"
          className="fixed inset-0 z-[var(--z-portal)] flex touch-none items-end justify-center [--bleed:3rem]"
        >
          <DrawerPrimitive.Popup
            data-slot="drawer-content"
            initialFocus={initialFocus}
            className={cn(
              "relative -mb-[var(--bleed)] flex max-h-[calc(92dvh+var(--bleed))] w-full flex-col rounded-t-2xl bg-popover pb-[calc(env(safe-area-inset-bottom,0px)+var(--bleed))] text-sm text-popover-foreground shadow-elevation-4 ring-1 ring-foreground/10 outline-none",
              "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-transform duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform data-swiping:select-none data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]",
              className
            )}
            {...props}
          >
            {/* Grab handle — the visible cue that the sheet swipes down. */}
            <div aria-hidden className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
            {children}
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.VirtualKeyboardProvider>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-header" className={cn("shrink-0 touch-none px-4 pb-2 pt-1 select-none", className)} {...props} />
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn("text-base font-semibold", className)} {...props} />
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return <DrawerPrimitive.Description data-slot="drawer-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

/** The scrolling region. `touch-auto` so a list scrolls instead of dragging the sheet. */
function DrawerBody({ className, ...props }: DrawerPrimitive.Content.Props) {
  return (
    <DrawerPrimitive.Content
      data-slot="drawer-body"
      className={cn("min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-4 pb-4", className)}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-1 [&_button]:w-full", className)}
      {...props}
    />
  )
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter }
