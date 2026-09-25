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
      {/* Header and footer stay put while the lists scroll between them — on a phone the
          widget list is long, and "Done" must not scroll away with it. dvh, not vh: the
          mobile browser's toolbar would otherwise cover the footer. This dialog lays out
          its own pinned header/footer on every size, so it opts out of the shared sheet. */}
      <DialogContent mobile="none" className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b border-border p-4 pr-10">
          <DialogTitle>Customise dashboard</DialogTitle>
          <DialogDescription>
            Choose what you see and how it is arranged. This is your own view — nobody else&apos;s dashboard changes, and
            hiding a widget here does not change what you have access to.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
        {/* ── Pages ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-2 py-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Pages</h3>
            <p className="text-xs text-muted-foreground">Group widgets into tabs</p>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {layout.pages.map((p, i) => (
              <li key={p.id} className="flex items-center gap-1.5 p-2 sm:gap-2">
                <LayoutDashboard className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                {/* On a phone the count sits under the name, so the name keeps the width. */}
                <div className="min-w-0 flex-1">
                  <Input
                    value={p.name}
                    aria-label={`Name of page ${i + 1}`}
                    onChange={(e) => onChange(renamePage(layout, p.id, e.target.value))}
                    // A page with no name is unclickable in the tab bar; fall back rather
                    // than block typing, so clearing the field to retype is not a trap.
                    onBlur={(e) => !e.target.value.trim() && onChange(renamePage(layout, p.id, `Page ${i + 1}`))}
                    className="h-9 sm:h-8"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground tabular-nums sm:hidden">
                    {rows.filter((w) => w.pageId === p.id && !w.hidden).length} shown
                  </span>
                </div>
                <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">
                  {rows.filter((w) => w.pageId === p.id && !w.hidden).length} shown
                </span>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 sm:h-8 sm:w-8" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => onChange(movePage(layout, p.id, -1))}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 sm:h-8 sm:w-8" aria-label={`Move ${p.name} later`} disabled={i === layout.pages.length - 1} onClick={() => onChange(movePage(layout, p.id, 1))}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive hover:text-destructive sm:h-8 sm:w-8"
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
              className="h-9 min-w-0 flex-1"
            />
            <Button type="button" variant="outline" className="h-9 shrink-0" onClick={addNewPage} disabled={!newPageName.trim()}>
              <Plus className="mr-1.5 h-4 w-4" /> Add<span className="hidden sm:inline">&nbsp;page</span>
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
                // Phone: two lines — the switch and the full name, then the two pickers
                // side by side at half width each. From sm up: one line, as before. (A
                // single wrapping flex row squeezed the name to one letter on a phone.)
                <li key={w.id} className={cn("grid grid-cols-2 gap-2 p-3 sm:flex sm:items-center sm:p-2", w.hidden && "opacity-60")}>
                  <div className="col-span-2 flex min-w-0 items-center gap-2 sm:flex-1">
                    <Switch
                      checked={!w.hidden}
                      onCheckedChange={(on) => onChange(updateWidget(layout, w.id, { hidden: !on }))}
                      aria-label={`Show ${def.title}`}
                    />
                    {w.hidden ? <EyeOff className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" /> : <Eye className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{def.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{def.group}</span>
                    </span>
                  </div>

                  <Select value={w.size} onValueChange={(v) => v && onChange(updateWidget(layout, w.id, { size: v as typeof w.size }))}>
                    {/* Select.Value shows the raw VALUE unless it is given a formatter,
                        which would put "sm" and a page id on screen. */}
                    <SelectTrigger className="h-9 w-full min-w-0 sm:h-8 sm:w-[124px]" aria-label={`Width of ${def.title}`}>
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
                    <SelectTrigger className="h-9 w-full min-w-0 sm:h-8 sm:w-[150px]" aria-label={`Page for ${def.title}`}>
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
        </div>

        <DialogFooter className="flex-row justify-between border-t border-border p-3 sm:justify-between sm:px-4">
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
