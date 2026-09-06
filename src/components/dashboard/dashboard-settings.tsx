"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirm } from "@/components/providers/confirm-provider"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown, Plus, Trash2, RotateCcw, LayoutDashboard, Eye, EyeOff } from "@/components/icons"
import {
  SIZE_LABEL,
  WIDGET_SIZES,
  addPage,
  movePage,
  removePage,
  renamePage,
  updateWidget,
  type DashboardLayout,
  type WidgetCatalogEntry,
  type WidgetSize,
} from "@/lib/dashboard/layout"

// The gear behind the Operations Dashboard: which widgets are on, how wide they are, and
// which page (tab) each one sits on.
//
// Applies IMMEDIATELY — every control writes straight through to the dashboard, which
// saves on change. There is no Save button and no draft copy on purpose: the dialog sits
// over the very page it edits, so the feedback for "hide Revenue mix" is Revenue mix
// disappearing, and a draft would put a lie on screen until the user pressed Save. Close
// is therefore never destructive, which is also why the only irreversible action here
// (deleting a page) asks first.

export function DashboardSettings({
  open,
  onOpenChange,
  layout,
  onChange,
  onReset,
  catalog,
  availableIds,
  activePageId,
  onActivePageChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout: DashboardLayout
  onChange: (next: DashboardLayout) => void
  onReset: () => void
  catalog: readonly WidgetCatalogEntry[]
  /** Widgets this session can actually see — the rest are not this user's to arrange. */
  availableIds: ReadonlySet<string>
  activePageId: string
  onActivePageChange: (id: string) => void
}) {
  const confirm = useConfirm()
  const [newPageName, setNewPageName] = React.useState("")

  const byId = React.useMemo(() => new Map(catalog.map((w) => [w.id, w])), [catalog])
  const pageName = (id: string) => layout.pages.find((p) => p.id === id)?.name ?? "—"

  // Ordered exactly as the dashboard renders them, so the list reads as the page does.
  const rows = layout.widgets.filter((w) => availableIds.has(w.id))
  const visibleCount = rows.filter((w) => !w.hidden).length

  const addNewPage = () => {
    const name = newPageName.trim()
    if (!name) return
    onChange(addPage(layout, name))
    setNewPageName("")
  }

  const deletePage = async (id: string) => {
    const moving = rows.filter((w) => w.pageId === id).length
    if (
      !(await confirm({
        title: `Delete "${pageName(id)}"?`,
        description: moving
          ? `Its ${moving} widget${moving === 1 ? "" : "s"} move to "${layout.pages[0].id === id ? layout.pages[1]?.name : layout.pages[0].name}" — nothing is lost.`
          : "The page is empty, so nothing moves.",
        confirmLabel: "Delete page",
        destructive: true,
      }))
    )
      return
    if (activePageId === id) onActivePageChange(layout.pages.find((p) => p.id !== id)!.id)
    onChange(removePage(layout, id))
  }

  const resetAll = async () => {
    if (
      !(await confirm({
        title: "Reset the dashboard?",
        description: "Every page you added is removed and all widgets go back to their original size, order and visibility. This affects only your own view.",
        confirmLabel: "Reset",
        destructive: true,
      }))
    )
      return
    onReset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Customise dashboard</DialogTitle>
          <DialogDescription>
            Choose what you see and how it is arranged. This is your own view — nobody else&apos;s dashboard changes, and
            hiding a widget here does not change what you have access to.
          </DialogDescription>
        </DialogHeader>

        {/* ── Pages ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-2 py-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Pages</h3>
            <p className="text-xs text-muted-foreground">Group widgets into tabs</p>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {layout.pages.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2 p-2">
                <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  value={p.name}
                  aria-label={`Name of page ${i + 1}`}
                  onChange={(e) => onChange(renamePage(layout, p.id, e.target.value))}
                  // A page with no name is unclickable in the tab bar; fall back rather
                  // than block typing, so clearing the field to retype is not a trap.
                  onBlur={(e) => !e.target.value.trim() && onChange(renamePage(layout, p.id, `Page ${i + 1}`))}
                  className="h-8"
                />
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {rows.filter((w) => w.pageId === p.id && !w.hidden).length} shown
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => onChange(movePage(layout, p.id, -1))}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${p.name} later`} disabled={i === layout.pages.length - 1} onClick={() => onChange(movePage(layout, p.id, 1))}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  aria-label={`Delete ${p.name}`}
                  disabled={layout.pages.length === 1}
                  onClick={() => deletePage(p.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <Input
              placeholder="New page name, e.g. Front office"
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addNewPage()
                }
              }}
              className="h-9"
            />
            <Button type="button" variant="outline" onClick={addNewPage} disabled={!newPageName.trim()}>
              <Plus className="mr-1.5 h-4 w-4" /> Add page
            </Button>
          </div>
        </section>

        {/* ── Widgets ───────────────────────────────────────────────────────────── */}
        <section className="space-y-2 py-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Widgets</h3>
            <p className="text-xs text-muted-foreground">
              {visibleCount} of {rows.length} shown
            </p>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((w) => {
              const def = byId.get(w.id)
              if (!def) return null
              return (
                <li key={w.id} className={cn("flex flex-wrap items-center gap-2 p-2", w.hidden && "opacity-60")}>
                  <Switch
                    checked={!w.hidden}
                    onCheckedChange={(on) => onChange(updateWidget(layout, w.id, { hidden: !on }))}
                    aria-label={`Show ${def.title}`}
                  />
                  {w.hidden ? <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{def.title}</span>
                    <span className="block text-xs text-muted-foreground">{def.group}</span>
                  </span>

                  <Select value={w.size} onValueChange={(v) => v && onChange(updateWidget(layout, w.id, { size: v as typeof w.size }))}>
                    {/* Select.Value shows the raw VALUE unless it is given a formatter,
                        which would put "sm" and a page id on screen. */}
                    <SelectTrigger className="h-8 w-[124px]" aria-label={`Width of ${def.title}`}>
                      <SelectValue>{(v) => SIZE_LABEL[v as WidgetSize] ?? String(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {WIDGET_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {SIZE_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={w.pageId} onValueChange={(v) => v && onChange(updateWidget(layout, w.id, { pageId: v }))}>
                    <SelectTrigger className="h-8 w-[150px]" aria-label={`Page for ${def.title}`}>
                      <SelectValue>{(v) => pageName(String(v))}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {layout.pages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Drag a card by its handle on the dashboard to reorder it, or focus the handle and use the arrow keys.
          </p>
        </section>

        <DialogFooter className="justify-between sm:justify-between">
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={resetAll}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reset to default
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
