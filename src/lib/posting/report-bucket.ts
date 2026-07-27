import { REPORT_BUCKET_LABELS, LEGACY_CATEGORY_TO_SUBGROUP, CANONICAL_GROUPS, type ReportBucket } from "@/lib/posting/charge-tree";

// The ONE way a report classifies a folio line. Every consumer that used to switch on
// ChargeCode.category (or, worse, on ChargeCode.code === "ROOM"/"GTX") reads the
// bucket through here instead — see CHARGE_CODE_PLAN.md §1.7.
//
// Falls back to the deprecated `category` string while the migration window is open, so
// a code that hasn't been backfilled into a subgroup yet still reports sanely rather
// than silently landing in OTHER.

// The prisma `include` fragment a caller needs so reportBucketOf() can resolve. Kept
// here so the shape and the reader can never drift apart.
export const CHARGE_BUCKET_INCLUDE = {
  chargeSubgroup: { include: { chargeGroup: true } },
} as const;

// A `select` variant for the read-only report paths that don't want the whole row.
export const CHARGE_BUCKET_SELECT = {
  id: true,
  code: true,
  category: true,
  postingType: true,
  chargeSubgroup: { select: { chargeGroup: { select: { reportBucket: true, isRevenue: true } } } },
} as const;

// A line item's charge code PLUS the code of whatever generated it, which is what
// `lineReportBucket()` needs. Use this wherever a report buckets folio lines.
export const LINE_BUCKET_INCLUDE = {
  chargeCode: { select: CHARGE_BUCKET_SELECT },
  generatedFrom: { select: { chargeCode: { select: CHARGE_BUCKET_SELECT } } },
} as const;

type BucketBearingChargeCode = {
  category?: string | null;
  chargeSubgroup?: { chargeGroup?: { reportBucket?: string | null } | null } | null;
} | null | undefined;

const LEGACY_CATEGORY_TO_BUCKET: Record<string, ReportBucket> = Object.fromEntries(
  Object.entries(LEGACY_CATEGORY_TO_SUBGROUP).map(([category, subgroupCode]) => {
    const group = CANONICAL_GROUPS.find((g) => g.subgroups.some((s) => s.code === subgroupCode))!;
    return [category, group.reportBucket];
  })
) as Record<string, ReportBucket>;

export function reportBucketOf(chargeCode: BucketBearingChargeCode): ReportBucket {
  const fromHierarchy = chargeCode?.chargeSubgroup?.chargeGroup?.reportBucket;
  if (fromHierarchy && fromHierarchy in REPORT_BUCKET_LABELS) return fromHierarchy as ReportBucket;
  const legacy = chargeCode?.category;
  if (legacy && LEGACY_CATEGORY_TO_BUCKET[legacy]) return LEGACY_CATEGORY_TO_BUCKET[legacy];
  return "OTHER";
}

/**
 * The bucket a folio LINE reports under.
 *
 * A generated tax line's own charge code lives in the TAX group (that is the point of
 * per-group tax codes — `GST-FNB` is a tax, not F&B revenue), so bucketing it by its own
 * code would strip every revenue report of its tax. Instead a generated line reports
 * under the bucket of the revenue line that produced it, which is where that money was
 * earned. Un-generated lines are unaffected.
 *
 * Requires `LINE_BUCKET_INCLUDE` on the query.
 */
export function lineReportBucket(line: {
  chargeCode?: BucketBearingChargeCode;
  generatedFrom?: { chargeCode?: BucketBearingChargeCode } | null;
}): ReportBucket {
  if (line.generatedFrom?.chargeCode) return reportBucketOf(line.generatedFrom.chargeCode);
  return reportBucketOf(line.chargeCode);
}

export function reportBucketLabel(bucket: string): string {
  return REPORT_BUCKET_LABELS[bucket as ReportBucket] ?? bucket.replace(/_/g, " ");
}

// True when a line is a government levy posted at face value (Green Tax and friends).
// Replaces the hardcoded `chargeCode?.code === "GTX"` checks in the GST reports: a levy
// is never service-charged or GST'd, so it must stay out of the GST base.
export function isLevyLine(chargeCode: { postingType?: string | null; code?: string | null } | null | undefined): boolean {
  if (!chargeCode) return false;
  if (chargeCode.postingType === "TAX") return true;
  // Migration-window fallback for a GTX row that predates postingType.
  return chargeCode.code === "GTX";
}
