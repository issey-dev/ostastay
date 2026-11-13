import { NextResponse } from "next/server";
import { hasCapability, type AuthContext } from "@/lib/scope";
import type { ReportResult } from "@/lib/reports/types";

// "Suppress rates" (Agent Portal plan §10, Phase 0b). A role without the `figures.see`
// capability must receive NO money figure from the server: rates, charge lines, totals,
// revenue. It is enforced here, on the response, never with CSS. The one exception the
// owner made (2026-11-11): the BALANCE DUE stays, so the desk can still collect and can
// stop a guest leaving unpaid.
//
// Every route that returns money goes through figuresJson() (or redactFigures() for a
// non-JSON body). tests/business-rules/suppress-rates.test.ts asserts both the redaction
// and that the money-bearing routes use it.

// Keys that carry money. Matched on the key name, case-insensitive, anywhere in the tree.
const MONEY_KEY =
  /(rate|rates|amount|amounts|total|totals|subtotal|price|prices|revenue|charge|charges|commission|cost|fee|fees|discount|tax|taxes|adr|revpar|net|gross|deposit|paid|value)$/i;

// Money keys that are NOT figures to hide: the balance (owner rule) and non-money words
// that happen to end the same way.
const KEEP_KEY = /^(balance|balanceDue|outstanding|amountDue|balanceAmount|status|.*Id|.*Ids|occupancyRate|isNet|.*Count)$/i;

// Whole branches that are nothing but money.
const DROP_BRANCH = /^(lineItems|charges|postings|dailyBreakdown|nightlyRates|priceBreakdown|ratesByNight|revenueByDay)$/i;

export const REDACTED_NOTE = "figuresHidden";

function isMoneyKey(key: string): boolean {
  if (KEEP_KEY.test(key)) return false;
  return MONEY_KEY.test(key);
}

/** Deep copy with every money figure removed. Dates and other objects are kept as they are. */
export function stripFigures<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripFigures(v)) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_BRANCH.test(k)) continue;
    if (isMoneyKey(k) && (typeof v === "number" || typeof v === "string" || v === null || isDecimalLike(v))) continue;
    out[k] = stripFigures(v);
  }
  return out as T;
}

function isDecimalLike(v: unknown): boolean {
  return !!v && typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function";
}

/** A report with its currency columns, money KPIs and charts taken out. */
export function stripReportFigures(result: ReportResult): ReportResult {
  const drop = new Set(
    result.columns.filter((c) => c.format === "currency" && !KEEP_KEY.test(c.key)).map((c) => c.key)
  );
  const clean = (row?: Record<string, unknown>) =>
    row ? Object.fromEntries(Object.entries(row).filter(([k]) => !drop.has(k))) : row;
  return {
    ...result,
    columns: result.columns.filter((c) => !drop.has(c.key)),
    rows: result.rows?.map((r) => clean(r)!),
    groups: result.groups?.map((g) => ({ ...g, rows: g.rows.map((r) => clean(r)!), subtotals: clean(g.subtotals) })),
    totals: clean(result.totals),
    summary: result.summary?.filter((k) => k.format !== "currency"),
    visuals: drop.size > 0 ? [] : result.visuals,
    note: [result.note, "Figures are hidden for your role."].filter(Boolean).join(" "),
  };
}

export function canSeeFigures(ctx: AuthContext): boolean {
  return hasCapability(ctx, "figures.see");
}

export function redactFigures<T>(ctx: AuthContext, value: T): T {
  if (canSeeFigures(ctx)) return value;
  // Round-trip through JSON first so Prisma Decimals and Dates are plain values, exactly
  // what the client would have received.
  const plain = JSON.parse(JSON.stringify(value)) as T;
  const stripped = stripFigures(plain);
  if (stripped && typeof stripped === "object" && !Array.isArray(stripped)) {
    (stripped as Record<string, unknown>)[REDACTED_NOTE] = true;
  }
  return stripped;
}

/** NextResponse.json with the caller's figures removed when their role suppresses rates. */
export function figuresJson<T>(ctx: AuthContext, value: T, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(redactFigures(ctx, value), init);
  if (!canSeeFigures(ctx)) res.headers.set("X-Figures-Hidden", "1");
  return res;
}
