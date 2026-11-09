"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Base UI 1.6.0's Panel only hides itself once its CSS exit "animation" completes
// (useOpenChangeComplete -> useAnimationsFinished) — but with no transition/animation
// ever defined on TabsContent, that completion callback never fires, so a panel that
// has been shown once never gets hidden again: every previously-visited tab's content
// stays mounted and visible underneath the current one forever. Reproducible with any
// <Tabs> in this app where a user switches between 2+ tabs in the same instance.
// Fixed once here rather than per call site: Tabs tracks the active value itself
// (mirroring whichever mode the consumer uses — controlled `value` or uncontrolled
// `defaultValue`) and hands it to TabsContent via context, which unmounts inactive
// panels directly via React instead of waiting on Panel's broken exit lifecycle.
// TabsTrigger/TabsList are unaffected by this bug — their active-state styling is a
// plain `data-active` CSS selector, no mount/animation lifecycle involved.
const TabsActiveValueContext = React.createContext<unknown>(undefined)

function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: TabsPrimitive.Root.Props) {
  const [activeValue, setActiveValue] = React.useState<unknown>(value ?? defaultValue ?? null)

  // Controlled mode: stay in sync whenever the consumer's own value changes.
  React.useEffect(() => {
    if (value !== undefined) setActiveValue(value)
  }, [value])

  return (
    <TabsActiveValueContext.Provider value={activeValue}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        orientation={orientation}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(newValue, eventDetails) => {
          // Uncontrolled mode: this is the only place the new value is observed.
          setActiveValue(newValue)
          onValueChange?.(newValue, eventDetails)
        }}
        className={cn(
          "group/tabs flex gap-2 data-horizontal:flex-col",
          className
        )}
        {...props}
      />
    </TabsActiveValueContext.Provider>
  )
}

const tabsListVariants = cva(
  // Orientation classes are self-referencing (data-horizontal:/data-vertical:), not
  // group-data-[...]/tabs: — TabsList already carries its own data-orientation
  // attribute, and a group-name lookup would incorrectly match through to an outer
  // ancestor <Tabs> of a different orientation whenever one <Tabs> is nested inside
  // another (e.g. the Controls sidebar's vertical Tabs wrapping a section's own
  // horizontal Tabs) — both instances share the same CSS group name "tabs", so the
  // group selector matches any ancestor with it, not just the nearest one.
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-1 text-muted-foreground data-horizontal:h-8 pointer-coarse:data-horizontal:h-11 data-vertical:h-fit data-vertical:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// Phones (owner, 2026-11-09): a horizontal tab row always fits the screen — never a sideways
// scroll — with at most 4 tabs per row: up to 4 share one row equally; 5–6 go 3 per row;
// 7–8 go 4 per row. Applied after the caller's classes so a page's `w-max`/`flex-nowrap`
// can't undo it. Vertical tab lists are untouched.
const PHONE_TABS_LIST =
  "max-sm:data-horizontal:grid max-sm:data-horizontal:w-full max-sm:data-horizontal:h-auto! max-sm:data-horizontal:gap-0.5 max-sm:data-horizontal:grid-flow-col max-sm:data-horizontal:auto-cols-fr " +
  "max-sm:data-horizontal:has-[>:nth-child(5)]:grid-flow-row max-sm:data-horizontal:has-[>:nth-child(5)]:grid-cols-3 max-sm:data-horizontal:has-[>:nth-child(7)]:grid-cols-4"
// …and each tab may wrap its label onto two lines instead of overflowing its cell.
const PHONE_TABS_TRIGGER = "max-sm:data-horizontal:min-h-9 max-sm:data-horizontal:min-w-0 max-sm:data-horizontal:whitespace-normal max-sm:data-horizontal:leading-tight max-sm:data-horizontal:text-center"

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className, PHONE_TABS_LIST)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // Orientation classes are self-referencing (data-horizontal:/data-vertical:) —
        // see the comment on tabsListVariants above for why a group-data-[...]/tabs:
        // lookup breaks under nested <Tabs>. The variant lookup (group-data-[variant=…])
        // is unaffected — a trigger has exactly one parent TabsList, no nesting risk.
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all data-vertical:w-full data-vertical:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity data-horizontal:after:inset-x-0 data-horizontal:after:bottom-[-5px] data-horizontal:after:h-0.5 data-vertical:after:inset-y-0 data-vertical:after:-right-1 data-vertical:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className,
        PHONE_TABS_TRIGGER
      )}
      {...props}
    />
  )
}

function TabsContent({ className, value, ...props }: TabsPrimitive.Panel.Props) {
  const activeValue = React.useContext(TabsActiveValueContext)
  // Unmount inactive panels directly via React (see the note above Tabs) instead of
  // trusting Panel's own hidden-once-animation-completes lifecycle, which never
  // completes when no CSS transition is defined.
  if (value !== activeValue) return null
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      value={value}
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
