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

/** Whether this code may carry tax — re-exported so pickers don't import two modules. */
export { canGenerateTax }
