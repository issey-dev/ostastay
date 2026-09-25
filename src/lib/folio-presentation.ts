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
  "by-check": "Summary by check number",
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
    "One line per check number: a charge and the Service Charge, GST and levies posted with it, or a night's room rate with everything posted for that night.",
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
  /** The posting's check number — lines posted together share it (FolioLineItem.checkNo). */
  checkNo?: string | null;
  /** Set on Night Audit's room-rate / extra-occupancy lines (and the lines they generate). */
  roomAssignmentId?: string | null;
  createdAt?: Date | string | null;
  /** When present, lines of different folios never roll together even with the same check. */
  folioId?: string | null;
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
      // Group on the charge code WITHIN a day. The day is part of the key on purpose: a
      // folio line carries one date, so a row that merged Monday's and Wednesday's
      // restaurant charges would print a single date next to a figure that isn't that
      // day's — the guest cannot reconcile it against their stay (owner rule,
      // 2026-08-03). Grouping compresses repetition inside a day, never across days.
      // Generated tax is folded into its parent first so a group's tax sits with the
      // revenue that earned it rather than in a separate GST row.
      return group(foldGeneratedIntoParent(live), (r) => `${dayKey(r.date)}|${r.description}`, {
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
      // One row per check number (FolioLineItem.checkNo) within the folio. A line with no
      // number of its own rides with the line that generated it; a root with none at all
      // is its own "check", with its generated lines folded in (the compact reading).
      // Still day-scoped: a check is one posting, so one day — but staff can edit numbers,
      // and a guest-facing row must never carry two days' money under one date.
      const byId = new Map(live.map((l) => [l.id, l]));
      const checkKeyOf = (l: PresentableLine): string => {
        let cur: PresentableLine = l;
        const seen = new Set<string>();
        for (;;) {
          if (cur.checkNo) return `chk:${cur.folioId ?? ""}|${cur.checkNo}`;
          seen.add(cur.id);
          const parent = cur.generatedFromLineItemId ? byId.get(cur.generatedFromLineItemId) : undefined;
          if (!parent || seen.has(parent.id)) return `line:${cur.id}`;
          cur = parent;
        }
      };
      const buckets = new Map<string, PresentableLine[]>();
      for (const l of live) {
        const k = `${dayKey(l.date)}|${checkKeyOf(l)}`;
        const list = buckets.get(k);
        if (list) list.push(l);
        else buckets.set(k, [l]);
      }
      return [...buckets.entries()].map(([key, members]) => {
        const main = pickMainLine(members);
        const check = members.find((m) => m.checkNo)?.checkNo ?? null;
        const rows = members.map(toRow);
        return {
          key,
          date: earliestDate(members),
          description: main.description,
          reference: check ?? toRow(main).reference,
          base: round2(rows.reduce((s, r) => s + r.base, 0)),
          serviceCharge: round2(rows.reduce((s, r) => s + r.serviceCharge, 0)),
          tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
          total: round2(rows.reduce((s, r) => s + r.total, 0)),
          count: members.length,
        };
      });
    }
  }
}

const timeOf = (d: Date | string | null | undefined) => (d == null ? Number.NaN : new Date(d).getTime());

function earliestDate(lines: PresentableLine[]): Date | string {
  let best = lines[0].date;
  for (const l of lines) if (timeOf(l.date) < timeOf(best)) best = l.date;
  return best;
}

/**
 * The line a rolled-up check is named after.
 *
 * 1. Only ROOT lines qualify — a line not generated by another member (Service Charge,
 *    GST, Green Tax and other levies are generated, so they never name the row). If every
 *    member is generated (the parent was voided or moved), all members qualify.
 * 2. Among those, a Night Audit room line wins (it carries `roomAssignmentId`) — so a
 *    stay-night reads as its room charge, not its extra occupancy or an allocation.
 * 3. Then the earliest posted (`createdAt`) — the room rate posts before extra occupancy.
 * 4. Then the larger amount, then the order given.
 */
export function pickMainLine<T extends PresentableLine>(members: T[]): T {
  const ids = new Set(members.map((m) => m.id));
  const roots = members.filter((m) => !m.generatedFromLineItemId || !ids.has(m.generatedFromLineItemId));
  const pool = roots.length > 0 ? roots : members;
  const room = pool.filter((m) => m.roomAssignmentId);
  const candidates = room.length > 0 ? room : pool;
  const order = new Map(members.map((m, i) => [m.id, i]));
  return [...candidates].sort((a, b) => {
    const ta = timeOf(a.createdAt);
    const tb = timeOf(b.createdAt);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    const byAmount = Math.abs(b.amount) - Math.abs(a.amount);
    if (Math.abs(byAmount) > 0.0001) return byAmount;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  })[0];
}

/** One row of the on-screen folio ledger: a single line, or a rolled-up check. */
export type LedgerEntry<T extends PresentableLine> =
  | { kind: "line"; key: string; line: T }
  | {
      kind: "check";
      key: string;
      checkNo: string;
      /** The line the row is named after (see pickMainLine). */
      main: T;
      /** Every live member, in the order given. */
      lines: T[];
      date: Date | string;
      base: number;
      serviceCharge: number;
      tax: number;
      total: number;
    };

/**
 * The folio screen's roll-up: live lines of ONE folio that share a check number collapse
 * into one entry. A voided line always stands alone (and never counts toward a group); a
 * number no other live line shares shows as an ordinary line. Entries keep the order of
 * their first line.
 */
export function rollUpByCheck<T extends PresentableLine>(lines: T[]): LedgerEntry<T>[] {
  const keyOf = (l: T) => (l.checkNo && !l.isVoid ? `${l.folioId ?? ""}|${l.checkNo}` : null);
  const members = new Map<string, T[]>();
  for (const l of lines) {
    const k = keyOf(l);
    if (!k) continue;
    const list = members.get(k);
    if (list) list.push(l);
    else members.set(k, [l]);
  }

  const out: LedgerEntry<T>[] = [];
  const emitted = new Set<string>();
  for (const l of lines) {
    const k = keyOf(l);
    const group = k ? members.get(k)! : null;
    if (!group || group.length < 2) {
      out.push({ kind: "line", key: l.id, line: l });
      continue;
    }
    if (emitted.has(k!)) continue;
    emitted.add(k!);
    const rows = group.map(toRow);
    out.push({
      kind: "check",
      key: `check:${k}`,
      checkNo: l.checkNo!,
      main: pickMainLine(group),
      lines: group,
      date: earliestDate(group),
      base: round2(rows.reduce((s, r) => s + r.base, 0)),
      serviceCharge: round2(rows.reduce((s, r) => s + r.serviceCharge, 0)),
      tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
    });
  }
  return out;
}

/** Mirrors the API's rule for a check number: 1–20 letters, digits or hyphens. */
export const CHECK_NO_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

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
