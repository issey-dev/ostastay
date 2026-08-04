"use client"

import { useMemo, useState } from "react"
import { Search, Trash2, ChevronDown, ChevronRight, Info } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  postableChargeCodes,
  groupChargeCodesByHierarchy,
  triStateOf,
  describeSelection,
  chargeCodeMatches,
  type ChargeCodeLike,
  type TriState,
} from "@/lib/charge-code-options"
import { cn } from "@/lib/utils"

// Routing Instructions — standing rules that auto-route a charge code to another folio.
//
// Replaces the flat wall of numeric chips this used to be. Chips could not show what a
// code WAS (only its number) and stopped being scannable past a dozen; the property's
// standard chart is 48. This is the redesign from the owner's design project
// (08 Routing Modal): search on top, codes grouped by the chart's own
// ChargeGroup → ChargeSubgroup hierarchy with code + description per row, whole-group
// and whole-subgroup toggles, and a footer tray so the selection is always visible.
// Structure follows the design; the rendering uses the app's own tokens and shadcn
// primitives so the modal sits naturally beside every other dialog.

type TargetOption = { id: string; label: string }

export type RoutingRule = {
  id: string
  chargeCode: { code: string; description?: string }
  targetFolio?: {
    folioNumber?: number
    reservationId?: string
    reservation?: { assignments?: { room?: { roomNumber?: string } | null }[] } | null
  } | null
}

// A checkbox that can also say "some of the things under me are selected".
function TriBox({ state, className = "" }: { state: TriState; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border text-[10px] font-bold leading-none",
        state === "none"
          ? "border-input bg-background text-transparent"
          : "border-primary bg-primary text-primary-foreground",
        className
      )}
    >
      {state === "all" ? "✓" : state === "some" ? "–" : ""}
    </span>
  )
}

// Highlights the matched run so a search result shows WHY it matched.
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-foreground">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

export function RoutingInstructionsDialog({
  isOpen,
  onClose,
  folioNumber,
  chargeCodes,
  targetOptions,
  rules,
  onDeleteRule,
  onSave,
  saving = false,
}: {
  isOpen: boolean
  onClose: () => void
  folioNumber?: number
  chargeCodes: ChargeCodeLike[]
  targetOptions: TargetOption[]
  rules: RoutingRule[]
  onDeleteRule: (ruleId: string) => void
  onSave: (chargeCodeIds: string[], targetFolioId: string) => void
  saving?: boolean
}) {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [targetId, setTargetId] = useState("")

  // Only codes a human may legitimately route — the same gate every other picker uses.
  const codes = useMemo(() => postableChargeCodes(chargeCodes), [chargeCodes])
  const groups = useMemo(() => groupChargeCodesByHierarchy(codes), [codes])

  const searching = query.trim().length > 0
  const matches = useMemo(
    () => (searching ? codes.filter((c) => chargeCodeMatches(c, query)) : []),
    [codes, query, searching]
  )

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) (on ? next.add(id) : next.delete(id))
      return next
    })

  const toggleOne = (id: string) => toggle([id], !selected.has(id))
  const setGroup = (ids: string[]) => toggle(ids, triStateOf(ids, selected) !== "all")

  const reset = () => {
    setQuery("")
    setSelected(new Set())
    setCollapsed(new Set())
    setTargetId("")
  }

  const close = () => {
    reset()
    onClose()
  }

  const summary = describeSelection(groups, selected)
  const canSave = selected.size > 0 && !!targetId && !saving

  const ruleTarget = (r: RoutingRule) => {
    const t = r.targetFolio
    const room = t?.reservation?.assignments?.[0]?.room?.roomNumber
    return t?.reservationId ? `Folio #${t.folioNumber}` : `Room ${room ?? "?"} · Folio #${t?.folioNumber}`
  }

  const CodeRow = ({ c, indent }: { c: ChargeCodeLike; indent: boolean }) => {
    const on = selected.has(c.id)
    return (
      <button
        type="button"
        onClick={() => toggleOne(c.id)}
        aria-pressed={on}
        className={cn(
          "flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0",
          indent && "pl-9",
          on ? "bg-muted/60" : "hover:bg-muted/40"
        )}
      >
        <TriBox state={on ? "all" : "none"} />
        <span className="w-11 shrink-0 font-mono text-xs font-semibold tabular-nums">{c.code}</span>
        <span className={cn("truncate text-sm", on ? "text-foreground" : "text-muted-foreground")}>
          <Highlight text={c.description} query={query} />
        </span>
        {searching && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {c.chargeSubgroup?.chargeGroup?.name ?? "—"}
          </span>
        )}
      </button>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Routing Instructions
            {folioNumber != null && <span className="text-muted-foreground"> · Folio #{folioNumber}</span>}
          </DialogTitle>
          <DialogDescription>
            Route selected charge codes to another folio or room. Applies to existing and future postings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {/* Active rules stay above the picker — this is the only place a standing
              rule can be removed, so the redesign keeps it rather than dropping it. */}
          {rules.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Active rules · {rules.length}
              </div>
              <div className="max-h-28 overflow-y-auto">
                {rules.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-sm last:border-b-0">
                    <span className="truncate">
                      <span className="font-mono text-xs font-semibold">{r.chargeCode.code}</span>
                      {r.chargeCode.description && <span className="text-muted-foreground"> {r.chargeCode.description}</span>}
                      <span className="text-muted-foreground"> → {ruleTarget(r)}</span>
                    </span>
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 shrink-0 px-2 text-destructive"
                      onClick={() => onDeleteRule(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Remove rule</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Charge codes
              </Label>
              <div className="flex gap-3 text-xs font-medium">
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => toggle(codes.map((c) => c.id), true)}>
                  Select all
                </button>
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            </div>

            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search code or description"
                className="pl-8"
              />
            </div>

            <div className="h-[19rem] overflow-y-auto rounded-md border border-border">
              {codes.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">No routable charge codes.</p>
              ) : searching ? (
                matches.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No code matches &ldquo;{query}&rdquo;.
                  </p>
                ) : (
                  matches.map((c) => <CodeRow key={c.id} c={c} indent={false} />)
                )
              ) : (
                groups.map((g) => {
                  const gIds = g.codes.map((c) => c.id)
                  const gState = triStateOf(gIds, selected)
                  const gOpen = !collapsed.has(g.key)
                  return (
                    <div key={g.key}>
                      {/* Sticky so the department stays visible while its codes scroll. */}
                      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border bg-muted px-3 py-2">
                        <button type="button" onClick={() => setGroup(gIds)} className="flex items-center gap-2.5" aria-label={`Select all in ${g.name}`}>
                          <TriBox state={gState} />
                          <span className="text-[11px] font-semibold uppercase tracking-wider">{g.name}</span>
                        </button>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {gIds.filter((id) => selected.has(id)).length}/{gIds.length}
                        </span>
                        <button
                          type="button"
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}
                          aria-label={gOpen ? `Collapse ${g.name}` : `Expand ${g.name}`}
                        >
                          {gOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </div>

                      {gOpen && g.subgroups.map((s) => {
                        const sIds = s.codes.map((c) => c.id)
                        // A subgroup header only earns its row when the group actually
                        // splits — a single subgroup would just repeat the group name.
                        const showSub = g.subgroups.length > 1
                        return (
                          <div key={s.key}>
                            {showSub && (
                              <button
                                type="button"
                                onClick={() => setGroup(sIds)}
                                className="flex w-full items-center gap-2.5 border-b border-border/60 bg-muted/40 px-3 py-1.5 pl-6 text-left"
                              >
                                <TriBox state={triStateOf(sIds, selected)} />
                                <span className="text-xs font-medium">{s.name}</span>
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {sIds.filter((id) => selected.has(id)).length}/{sIds.length}
                                </span>
                              </button>
                            )}
                            {s.codes.map((c) => <CodeRow key={c.id} c={c} indent={showSub} />)}
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>

            {searching && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {matches.length} of {codes.length} codes match &ldquo;{query}&rdquo; · selections are kept while you search
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Route to
              <span
                title="Existing matching charges move immediately; future postings, including those made by Night Audit, follow the rule."
                className="text-muted-foreground"
              >
                <Info className="h-3.5 w-3.5" />
              </span>
            </Label>
            <Select value={targetId} onValueChange={(v) => setTargetId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select guest, travel agent, or another room">
                  {targetOptions.find((o) => o.id === targetId)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetOptions.length === 0 && (
              <p className="text-sm text-warning">
                Add another folio window (Add Folio) or check in another room to route charges.
              </p>
            )}
          </div>
        </div>

        {/* Footer tray — the selection stays visible no matter where the list is scrolled. */}
        <div className="-mx-6 -mb-6 mt-2 flex flex-col gap-3 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {selected.size === 0 ? (
              "No codes selected"
            ) : (
              <>
                <strong className="tabular-nums text-foreground">{selected.size} code{selected.size === 1 ? "" : "s"}</strong>
                {summary && <> selected · {summary}</>}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => onSave([...selected], targetId)}>
              {saving ? "Saving..." : "Save routing"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
