import { canGenerateTax } from "@/lib/posting/charge-tree"

// Turns `/api/charge-codes` rows into picker options, grouped by the charge hierarchy.
//
// This exists because the standard chart is 48 codes, and most of them must never be
// hand-picked: the 15 tax codes are posted BY generates (offering them would let an
// operator post a bare GST line), and the System codes are the app's own movements.
// Every picker in the app funnels through here so that judgement lives in one place
// rather than being re-decided — differently — in nine components.

export type ChargeCodeLike = {
  id: string
  code: string
  description: string
  postingType?: string | null
  isActive?: boolean | null
  chargeSubgroup?: {
    code?: string | null
    name?: string | null
    sortOrder?: number | null
    chargeGroup?: { code?: string | null; name?: string | null; reportBucket?: string | null; sortOrder?: number | null } | null
  } | null
}

export type ChargeCodeOptionFilter = {
  /** Only codes in these reporting buckets. Omit for all. */
  buckets?: string[]
  /** Include TAX-posting codes. Off by default — those are posted by generates, never by hand. */
  includeTax?: boolean
  /** Include the SYSTEM bucket. Off by default. */
  includeSystem?: boolean
  /** Include NON_REVENUE (deposits, commissions, payment movements). Off by default. */
  includeNonRevenue?: boolean
  /** Include deactivated codes. Off by default. */
  includeInactive?: boolean
}

/**
 * The codes a human may legitimately choose in this context.
 *
 * Default: active revenue codes only. A caller that genuinely needs more — the
 * commission-code picker needs NON_REVENUE, the Green-Tax picker needs TAX — opts in
 * explicitly, which keeps every widening deliberate and greppable.
 */
export function postableChargeCodes<T extends ChargeCodeLike>(codes: T[], filter: ChargeCodeOptionFilter = {}): T[] {
  const bucketOf = (c: T) => c.chargeSubgroup?.chargeGroup?.reportBucket ?? null
  return codes
    .filter((c) => filter.includeInactive || c.isActive !== false)
    .filter((c) => filter.includeTax || c.postingType !== "TAX")
    .filter((c) => filter.includeSystem || bucketOf(c) !== "SYSTEM")
    .filter((c) => filter.includeNonRevenue || bucketOf(c) !== "NON_REVENUE")
    .filter((c) => !filter.buckets || filter.buckets.includes(bucketOf(c) ?? ""))
    .sort(compareByHierarchy)
}

/** Group → Subgroup → code order, so a grouped picker reads like the chart. */
export function compareByHierarchy(a: ChargeCodeLike, b: ChargeCodeLike): number {
  const ga = a.chargeSubgroup?.chargeGroup
  const gb = b.chargeSubgroup?.chargeGroup
  const byGroup = (ga?.sortOrder ?? 9999) - (gb?.sortOrder ?? 9999)
  if (byGroup) return byGroup
  const byGroupName = (ga?.name ?? "").localeCompare(gb?.name ?? "")
  if (byGroupName) return byGroupName
  const bySub = (a.chargeSubgroup?.sortOrder ?? 9999) - (b.chargeSubgroup?.sortOrder ?? 9999)
  if (bySub) return bySub
  const bySubName = (a.chargeSubgroup?.name ?? "").localeCompare(b.chargeSubgroup?.name ?? "")
  if (bySubName) return bySubName
  return a.code.localeCompare(b.code)
}

/** The heading a code sits under in a grouped picker. */
export function chargeCodeGroupLabel(c: ChargeCodeLike): string {
  const group = c.chargeSubgroup?.chargeGroup?.name
  const sub = c.chargeSubgroup?.name
  if (group && sub) return `${group} › ${sub}`
  return group ?? "Unclassified"
}

/** Ready-to-use SearchableSelect options, grouped and filtered. */
export function chargeCodeOptions(
  codes: ChargeCodeLike[],
  filter: ChargeCodeOptionFilter = {}
): Array<{ label: string; value: string; group: string }> {
  return postableChargeCodes(codes, filter).map((c) => ({
    label: `${c.code} — ${c.description}`,
    value: c.id,
    group: chargeCodeGroupLabel(c),
  }))
}

// ── Two-level tree for the grouped routing picker ────────────────────────────
// The flat chip list the Routing modal used could not show what a code WAS, and
// stopped scaling past a dozen codes. The redesign (2026-08-03) is a grouped
// checklist, which needs the chart's own shape: ChargeGroup → ChargeSubgroup → code.
//
// A pure function so it can be unit-tested without a database, and so the picker
// component stays about interaction rather than data shaping.

export type ChargeCodeSubgroupNode<T> = {
  /** Stable key for React and for tracking collapse/selection state. */
  key: string
  name: string
  codes: T[]
}

export type ChargeCodeGroupNode<T> = {
  key: string
  name: string
  subgroups: ChargeCodeSubgroupNode<T>[]
  /** Every code in the group, flattened — for group-level counts and toggles. */
  codes: T[]
}

const UNCLASSIFIED = "Unclassified"

/**
 * Bucket codes into Group → Subgroup, preserving the chart's own ordering.
 *
 * Codes with no subgroup (or no group) collect under "Unclassified" rather than being
 * dropped: a picker that silently omits a code is worse than one that shows it in an
 * obvious catch-all, because the operator cannot tell the difference between "not
 * routable" and "missing".
 */
export function groupChargeCodesByHierarchy<T extends ChargeCodeLike>(
  codes: T[]
): ChargeCodeGroupNode<T>[] {
  const groups = new Map<string, ChargeCodeGroupNode<T>>()

  for (const c of [...codes].sort(compareByHierarchy)) {
    const groupName = c.chargeSubgroup?.chargeGroup?.name ?? UNCLASSIFIED
    const subName = c.chargeSubgroup?.name ?? UNCLASSIFIED

    let group = groups.get(groupName)
    if (!group) {
      group = { key: groupName, name: groupName, subgroups: [], codes: [] }
      groups.set(groupName, group)
    }
    group.codes.push(c)

    let sub = group.subgroups.find((s) => s.name === subName)
    if (!sub) {
      sub = { key: `${groupName}::${subName}`, name: subName, codes: [] }
      group.subgroups.push(sub)
    }
    sub.codes.push(c)
  }

  return [...groups.values()]
}

/** ✓ all / − some / empty none — the tri-state a group or subgroup header shows. */
export type TriState = "all" | "some" | "none"

export function triStateOf(codeIds: string[], selected: Set<string>): TriState {
  if (codeIds.length === 0) return "none"
  let hits = 0
  for (const id of codeIds) if (selected.has(id)) hits++
  return hits === 0 ? "none" : hits === codeIds.length ? "all" : "some"
}

/**
 * Compact description of a selection for the modal footer — the design's tray.
 * Names whole groups where every code is selected, then individual codes, and
 * collapses to a bare count past `max` entries so the footer never wraps.
 */
export function describeSelection<T extends ChargeCodeLike>(
  groups: ChargeCodeGroupNode<T>[],
  selected: Set<string>,
  max = 3
): string {
  const parts: string[] = []
  const claimed = new Set<string>()

  for (const g of groups) {
    if (g.codes.length > 0 && triStateOf(g.codes.map((c) => c.id), selected) === "all") {
      parts.push(`${g.name} (all)`)
      for (const c of g.codes) claimed.add(c.id)
    }
  }
  for (const g of groups) {
    for (const c of g.codes) {
      if (selected.has(c.id) && !claimed.has(c.id)) parts.push(c.code)
    }
  }

  if (parts.length === 0) return ""
  if (parts.length > max) return `${parts.slice(0, max).join(", ")} +${parts.length - max} more`
  return parts.join(", ")
}

/** Does this code match a free-text query on its code or description? */
export function chargeCodeMatches(c: ChargeCodeLike, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
}

/** Whether this code may carry tax — re-exported so pickers don't import two modules. */
export { canGenerateTax }
