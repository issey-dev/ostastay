// Folio presentation styles — how a Proforma / Tax Invoice / Interim Bill lays its
// charges out. The posted ledger is always the same rows; a style only decides how they
// are grouped for the guest.
//
// This matters more since tax moved onto its own lines: a folio now physically holds a
// Service Charge and a GST line per revenue group (see src/lib/posting/charge-tree.ts).
// That is exactly what an accountant wants and rarely what a guest wants, so "Detailed"
// shows every line while the other styles roll them up.
//
// Pure — no Prisma, no React — so the API, the print page and any future PDF path all
// group identically.

export const FOLIO_STYLES = ["detailed", "compact", "by-code", "by-date", "by-check"] as const;
export type FolioStyle = (typeof FOLIO_STYLES)[number];

export const FOLIO_STYLE_LABELS: Record<FolioStyle, string> = {
  detailed: "Detailed",
  compact: "Detailed — taxes merged",
  "by-code": "Summary by charge code",
  "by-date": "Summary by date",
  "by-check": "Summary by check",
};

export const FOLIO_STYLE_DESCRIPTIONS: Record<FolioStyle, string> = {
  detailed:
    "Every posted transaction, with each charge's Service Charge and GST shown as their own lines against the group's tax codes.",
  compact:
    "One line per charge, with its generated Service Charge and GST folded back into it. The usual guest-facing folio.",
  "by-code":
    "One line per charge code for the whole stay — the classic summary folio.",
  "by-date":
    "One line per date: everything charged on a day collapses into a single figure.",
  "by-check":
    "Outlet charges grouped by their sales-check number; everything else summarised by charge code.",
};

export function isFolioStyle(v: unknown): v is FolioStyle {
  return typeof v === "string" && (FOLIO_STYLES as readonly string[]).includes(v);
}

/** The subset of a FolioLineItem this module needs. */
export type PresentableLine = {
  id: string;
  date: Date | string;
  description: string;
  reference?: string | null;
  amount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  isVoid?: boolean;
  generatedFromLineItemId?: string | null;
  chargeCode?: { code?: string | null; description?: string | null } | null;
  outletCheck?: { checkNumber?: string | null } | null;
};

export type PresentedRow = {
  /** Stable key for React. */
  key: string;
  date: Date | string;
  description: string;
  reference: string | null;
  /** Pre-tax base of everything in the row. */
  base: number;
  serviceCharge: number;
  tax: number;
  /** base + serviceCharge + tax — what the guest sees in the Amount column. */
  total: number;
  /** How many posted lines this row represents (1 unless rolled up). */
  count: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dayKey = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Lay a folio's posted lines out in the requested style.
 *
 * Every style totals to the same figure — grouping never changes what is owed, only how
 * it reads. Voided lines are excluded from all of them.
 */
export function buildFolioRows(lines: PresentableLine[], style: FolioStyle): PresentedRow[] {
  const live = lines.filter((l) => !l.isVoid);

  switch (style) {
    case "detailed":
      return live.map(toRow);

    case "compact":
      return foldGeneratedIntoParent(live);

    case "by-code":
      // Group on the charge code, dropping the date — a summary folio is about "what was
      // bought", not when. Generated tax is folded into its parent first so a group's tax
      // sits with the revenue that earned it rather than in a separate GST row.
      return group(foldGeneratedIntoParent(live), (r) => r.description, {
        date: (rows) => rows[0].date,
        reference: () => null,
      });

    case "by-date":
      return group(foldGeneratedIntoParent(live), (r) => dayKey(r.date), {
        date: (rows) => rows[0].date,
        description: (rows) => `Charges — ${rows.length} transaction${rows.length === 1 ? "" : "s"}`,
        reference: () => null,
      });

    case "by-check": {
      const folded = foldGeneratedIntoParent(live);
      // A line's check number when it has one, else its own description — so outlet sales
      // roll to their check and room/front-desk charges still summarise sensibly.
      const checkOf = new Map(live.map((l) => [l.id, l.outletCheck?.checkNumber ?? null]));
      return group(folded, (r) => checkOf.get(r.key) ?? `code:${r.description}`, {
        date: (rows) => rows[0].date,
        description: (rows) => {
          const check = checkOf.get(rows[0].key);
          return check ? `Outlet check ${check}` : rows[0].description;
        },
        reference: (rows) => checkOf.get(rows[0].key) ?? null,
      });
    }
  }
}

function toRow(l: PresentableLine): PresentedRow {
  const base = l.amount;
  const sc = l.serviceChargeAmount || 0;
  const tax = l.taxAmount || 0;
  return {
    key: l.id,
    date: l.date,
    description: l.description,
    reference: l.reference ?? l.outletCheck?.checkNumber ?? l.chargeCode?.code ?? null,
    base,
    serviceCharge: sc,
    tax,
    total: round2(base + sc + tax),
    count: 1,
  };
}

/**
 * Merge every generated line back into the line that produced it, so a charge reads as
 * one row carrying its own tax — the way a folio looked before tax moved onto its own
 * codes, and the way most guests expect to see it.
 *
 * A generated line whose parent isn't in this set (routed to another folio window) is
 * kept as its own row rather than silently dropped.
 */
function foldGeneratedIntoParent(lines: PresentableLine[]): PresentedRow[] {
  const byId = new Map(lines.map((l) => [l.id, toRow(l)]));
  const orphans: PresentedRow[] = [];

  for (const l of lines) {
    if (!l.generatedFromLineItemId) continue;
    const parent = byId.get(l.generatedFromLineItemId);
    const own = byId.get(l.id)!;
    byId.delete(l.id);
    if (!parent) {
      orphans.push(own);
      continue;
    }
    parent.base = round2(parent.base + own.base);
    parent.serviceCharge = round2(parent.serviceCharge + own.serviceCharge);
    parent.tax = round2(parent.tax + own.tax);
    parent.total = round2(parent.total + own.total);
  }

  // Preserve posting order.
  const order = new Map(lines.map((l, i) => [l.id, i]));
  return [...byId.values(), ...orphans].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

function group(
  rows: PresentedRow[],
  keyOf: (r: PresentedRow) => string,
  fields: {
    date: (rows: PresentedRow[]) => Date | string;
    description?: (rows: PresentedRow[]) => string;
    reference: (rows: PresentedRow[]) => string | null;
  }
): PresentedRow[] {
  const buckets = new Map<string, PresentedRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }

  return [...buckets.entries()].map(([key, group]) => ({
    key,
    date: fields.date(group),
    description: fields.description ? fields.description(group) : group[0].description,
    reference: fields.reference(group),
    base: round2(group.reduce((s, r) => s + r.base, 0)),
    serviceCharge: round2(group.reduce((s, r) => s + r.serviceCharge, 0)),
    tax: round2(group.reduce((s, r) => s + r.tax, 0)),
    total: round2(group.reduce((s, r) => s + r.total, 0)),
    count: group.reduce((s, r) => s + r.count, 0),
  }));
}
