"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { widgetsByGroup, WIDGET_IDS } from "@/lib/dashboard/widgets"

// Which Operations Dashboard widgets a role is shown.
//
// The state passed around is the BLOCK list (widget ids this role may not see), because
// that is what gets stored — see RoleDashboardWidget. The checkboxes are the inverse:
// ticked means visible, which is the way an administrator thinks about it, and it means a
// widget added in a later release is on by default instead of invisible until somebody
// remembers to tick it.
//
// Worth saying plainly on screen, because it is the thing an admin will otherwise assume
// wrongly: this is curation, not access control. Unticking Revenue mix takes the card off
// that role's dashboard; it does not stop the role reaching revenue figures, which is what
// the Revenue module above it decides.

export function RoleWidgetAccess({
  value,
  onChange,
  disabled,
}: {
  /** Widget ids this role may NOT see. */
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const blocked = React.useMemo(() => new Set(value), [value])
  const groups = React.useMemo(() => widgetsByGroup(), [])
  const shownCount = WIDGET_IDS.length - blocked.size

  const setBlocked = (next: Set<string>) => onChange([...next])

  const toggle = (id: string) => {
    const next = new Set(blocked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setBlocked(next)
  }

  const setGroup = (ids: string[], visible: boolean) => {
    const next = new Set(blocked)
    for (const id of ids) {
      if (visible) next.delete(id)
      else next.add(id)
    }
    setBlocked(next)
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <div>
          <h4 className="text-sm font-semibold">Dashboard widgets</h4>
          <p className="text-xs text-muted-foreground">
            Which cards this role sees on the Operations Dashboard. Everything is on unless you turn it off.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {shownCount} of {WIDGET_IDS.length} shown
          </span>
          <Button type="button" variant="outline" size="sm" disabled={disabled || blocked.size === 0} onClick={() => setBlocked(new Set())}>
            Show all
          </Button>
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ group, widgets }) => {
          const ids = widgets.map((w) => w.id)
          const allOn = ids.every((id) => !blocked.has(id))
          return (
            <div key={group} className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2 border-b border-border/60 pb-1">
                <Checkbox
                  checked={allOn}
                  disabled={disabled}
                  onCheckedChange={(on) => setGroup(ids, on === true)}
                  aria-label={`Show every ${group} widget`}
                />
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</span>
              </div>
              <ul className="space-y-1">
                {widgets.map((w) => (
                  <li key={w.id}>
                    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-60")}>
                      <Checkbox checked={!blocked.has(w.id)} disabled={disabled} onCheckedChange={() => toggle(w.id)} />
                      <span className="min-w-0 truncate">{w.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        This decides what is put in front of the role, not what it may reach. A card is only ever shown when the module that
        owns its data — Revenue, Housekeeping and so on — is granted above.
      </p>
    </div>
  )
}
