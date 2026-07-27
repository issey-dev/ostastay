"use client"

import { useMemo, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronDown, ChevronRight } from "@/components/icons"
import { postableChargeCodes, type ChargeCodeLike } from "@/lib/charge-code-options"

export type ChargeCodeOption = ChargeCodeLike

type SubgroupNode = { code: string; name: string; codes: ChargeCodeOption[] }
type GroupNode = { code: string; name: string; subgroups: SubgroupNode[]; codes: ChargeCodeOption[] }

// Builds the Group → Subgroup → Code tree the picker renders, preserving the hierarchy's
// own ordering (postableChargeCodes already sorts by it).
function buildTree(codes: ChargeCodeOption[]): GroupNode[] {
  const groups = new Map<string, GroupNode>()
  for (const c of codes) {
    const g = c.chargeSubgroup?.chargeGroup
    const gKey = g?.code ?? "UNCLASSIFIED"
    const gNode = groups.get(gKey) ?? { code: gKey, name: g?.name ?? "Unclassified", subgroups: [], codes: [] }
    const sKey = c.chargeSubgroup?.code ?? "UNCLASSIFIED"
    let sNode = gNode.subgroups.find((s) => s.code === sKey)
    if (!sNode) {
      sNode = { code: sKey, name: c.chargeSubgroup?.name ?? "Unclassified", codes: [] }
      gNode.subgroups.push(sNode)
    }
    sNode.codes.push(c)
    gNode.codes.push(c)
    groups.set(gKey, gNode)
  }
  return [...groups.values()]
}

// An Outlet's curated charge-code pool, picked at whichever level makes sense: a whole
// Group, a Subgroup, or individual codes. Properties tend to organise codes subgroup-wise
// per outlet ("the restaurant sells everything under Restaurant and Bar"), so selecting a
// subgroup in one click is the common case and picking a single code is the exception.
//
// A charge code is never OWNED by an outlet — this only decides which of the enterprise's
// codes the outlet exposes in its own POS view. Tax and System codes are excluded
// entirely: those are posted by generates, never sold over a counter.
export function OutletChargeCodePicker({
  allChargeCodes,
  selectedIds,
  onChange,
}: {
  allChargeCodes: ChargeCodeOption[]
  selectedIds: string[]
  onChange: (next: string[]) => void
}) {
  const [search, setSearch] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const sellable = useMemo(() => postableChargeCodes(allChargeCodes), [allChargeCodes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sellable
    return sellable.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.chargeSubgroup?.name ?? "").toLowerCase().includes(q) ||
        (c.chargeSubgroup?.chargeGroup?.name ?? "").toLowerCase().includes(q)
    )
  }, [sellable, search])

  const tree = useMemo(() => buildTree(filtered), [filtered])
  const selected = new Set(selectedIds)

  const setMany = (codes: ChargeCodeOption[], on: boolean) => {
    const ids = codes.map((c) => c.id)
    onChange(on ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter((id) => !ids.includes(id)))
  }
  const toggleOne = (id: string) =>
    onChange(selected.has(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id])

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // "All", "some" or "none" of a set — drives the tri-state header checkbox.
  const stateOf = (codes: ChargeCodeOption[]) => {
    const on = codes.filter((c) => selected.has(c.id)).length
    return on === 0 ? "none" : on === codes.length ? "all" : "some"
  }

  if (sellable.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No sellable charge codes yet — add some under Controls &gt; Cashiering &gt; Charge Codes first.
      </p>
    )
  }

  const selectedCount = sellable.filter((c) => selected.has(c.id)).length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search group, subgroup or code..."
          className="h-9"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {selectedCount} of {sellable.length}
        </span>
        {selectedCount > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setMany(sellable, false)}>
            Clear
          </Button>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {tree.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">Nothing matches “{search}”.</p>
        ) : (
          tree.map((group) => {
            const gState = stateOf(group.codes)
            const gCollapsed = collapsed.has(group.code)
            return (
              <div key={group.code} className="border-b border-border/60 last:border-b-0">
                <div className="flex items-center gap-2 bg-muted/50 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(group.code)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={gCollapsed ? "Expand" : "Collapse"}
                  >
                    {gCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-semibold">
                    <Checkbox
                      checked={gState === "all"}
                      indeterminate={gState === "some"}
                      onCheckedChange={() => setMany(group.codes, gState !== "all")}
                    />
                    {group.name}
                    <span className="font-normal text-xs text-muted-foreground">
                      ({group.codes.filter((c) => selected.has(c.id)).length}/{group.codes.length})
                    </span>
                  </label>
                </div>

                {!gCollapsed &&
                  group.subgroups.map((sub) => {
                    const sState = stateOf(sub.codes)
                    return (
                      <div key={sub.code} className="px-2 py-1.5 pl-8">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={sState === "all"}
                            indeterminate={sState === "some"}
                            onCheckedChange={() => setMany(sub.codes, sState !== "all")}
                          />
                          <span className="font-medium">{sub.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({sub.codes.filter((c) => selected.has(c.id)).length}/{sub.codes.length})
                          </span>
                        </label>
                        <div className="mt-1 space-y-1 pl-6">
                          {sub.codes.map((c) => (
                            <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleOne(c.id)} />
                              <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                              <span className="text-muted-foreground">{c.description}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tick a Group or Subgroup to take everything under it. Tax and System codes aren&apos;t
        listed — those post automatically via generates, never over a counter.
      </p>
    </div>
  )
}
