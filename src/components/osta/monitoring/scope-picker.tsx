"use client"

import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ChevronDown, Search, X } from "@/components/icons"
import { cn } from "@/lib/utils"

// What the Monitoring page looks at, as ONE control shaped like a path ("Veyo / All
// properties") instead of two dropdowns: enterprises on the left, the chosen enterprise's
// properties on the right, one search box over both. Choosing an enterprise keeps the
// popover open on its properties; choosing a property (or "All properties") closes it.

export type PickerEnterprise = {
  id: string
  name: string
  internal: boolean
  properties: { id: string; name: string; code: string }[]
}

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")

function Avatar({ label, className }: { label: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-5 shrink-0 items-center justify-center bg-foreground text-[9px] font-bold text-background", className)}>
      {label}
    </span>
  )
}

export function ScopePicker({
  enterprises,
  enterpriseId,
  propertyId,
  onChange,
}: {
  enterprises: PickerEnterprise[]
  enterpriseId: string
  propertyId: string
  onChange: (enterpriseId: string, propertyId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  // The enterprise whose properties the right pane shows (may differ from the applied one).
  const [focusEnt, setFocusEnt] = React.useState(enterpriseId)

  React.useEffect(() => {
    if (open) {
      setFocusEnt(enterpriseId)
      setQ("")
    }
  }, [open, enterpriseId])

  const current = enterprises.find((e) => e.id === enterpriseId) ?? null
  const currentProp = current?.properties.find((p) => p.id === propertyId) ?? null
  const term = q.trim().toLowerCase()

  // A property match also surfaces its enterprise, so typing a property's name works.
  const entList = enterprises.filter(
    (e) => !term || e.name.toLowerCase().includes(term) || e.properties.some((p) => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))
  )
  const focused = enterprises.find((e) => e.id === focusEnt) ?? null
  const propList = (focused?.properties ?? []).filter((p) => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || focused!.name.toLowerCase().includes(term))

  const apply = (e: string, p: string) => {
    onChange(e, p)
    setOpen(false)
  }

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    // Enter: the single obvious match — a property if the term names one, else the first enterprise.
    if (term) {
      for (const ent of entList) {
        const prop = ent.properties.find((p) => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))
        if (prop) return apply(ent.id, prop.id)
      }
    }
    if (entList[0]) apply(entList[0].id, "")
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="outline" className={cn("h-9 max-w-[min(30rem,80vw)] gap-2 px-2.5", enterpriseId && "border-foreground")} aria-label="Choose what to monitor" />}
        >
          <Avatar label={current ? initials(current.name) : "ALL"} />
          <span className="truncate font-medium">{current ? current.name : "All enterprises"}</span>
          <span className="text-muted-foreground/60" aria-hidden="true">/</span>
          <span className="truncate text-muted-foreground">{currentProp ? currentProp.name : "All properties"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(36rem,calc(100vw-2rem))] gap-0 rounded-none p-0">
          <label className="flex h-11 items-center gap-2 border-b px-3 text-muted-foreground">
            <Search className="h-4 w-4 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Find an enterprise or property…"
              aria-label="Find an enterprise or property"
              className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="grid max-h-80 grid-cols-2 max-sm:grid-cols-1">
            <div className="overflow-y-auto border-r py-1 max-sm:border-r-0 max-sm:border-b">
              <p className="px-3 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">Enterprise</p>
              {!term && (
                <Option active={!enterpriseId} onClick={() => apply("", "")}>
                  <Avatar label="ALL" />
                  <span className="flex-1">All enterprises</span>
                </Option>
              )}
              {entList.map((e) => (
                <Option key={e.id} active={focusEnt === e.id} onClick={() => setFocusEnt(e.id)} onDoubleClick={() => apply(e.id, "")}>
                  <Avatar label={initials(e.name)} className={e.internal ? "bg-primary text-primary-foreground" : undefined} />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{e.properties.length} ›</span>
                </Option>
              ))}
              {entList.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Nothing matches.</p>}
            </div>
            <div className="overflow-y-auto py-1">
              {focused ? (
                <>
                  <p className="px-3 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">Property in {focused.name}</p>
                  <Option active={enterpriseId === focused.id && !propertyId} onClick={() => apply(focused.id, "")}>
                    <span className="flex-1">All properties</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{focused.properties.length}</span>
                  </Option>
                  {propList.map((p) => (
                    <Option key={p.id} active={propertyId === p.id} onClick={() => apply(focused.id, p.id)}>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    </Option>
                  ))}
                </>
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Pick an enterprise to see its properties.</p>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {enterpriseId && (
        <Button variant="ghost" size="icon" aria-label="Back to all enterprises" onClick={() => onChange("", "")}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function Option({
  active,
  children,
  onClick,
  onDoubleClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
  onDoubleClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        active && "bg-primary/5 font-semibold shadow-[inset_3px_0_0_var(--primary)]"
      )}
    >
      {children}
    </button>
  )
}
