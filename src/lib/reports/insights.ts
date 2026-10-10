import type {
  InsightFormat,
  ReportInsightsSpec,
  ReportKpi,
  ReportKpiSpec,
  ReportResult,
  ReportVisual,
  ReportVisualSpec,
} from "@/lib/reports/types";
import { formatDateUtc } from "@/lib/reports/format";

// Resolve a report's `insights` spec against its own rows. Pure and synchronous, so the
// same code is trusted for the screen, the print page and the Excel summary sheet — and
// is unit-tested against the table's own totals (tests/business-rules/report-insights).

type Row = Record<string, unknown>;

/** Every data row of a result, groups flattened (subtotal/total rows excluded). */
// Grouped rows carry their group's label under the pseudo-column "$group", so a chart can
// be drawn "per cashier" / "per attendant" / "per room type".
export function allRows(result: Pick<ReportResult, "rows" | "groups">): Row[] {
  return result.groups ? result.groups.flatMap((g) => g.rows.map((r) => ({ ...r, $group: g.label }))) : (result.rows ?? []);
}

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || v === "—";

const sameValue = (a: unknown, b: unknown) => (isBlank(a) ? isBlank(b) : String(a) === String(b));

function aggregate(rows: Row[], agg: ReportKpiSpec["agg"], column?: string): number {
  if (agg === "count") return rows.length;
  if (!column) return 0;
  const vals = rows.map((r) => r[column]);
  switch (agg) {
    case "sum":
      return vals.reduce<number>((s, v) => s + num(v), 0);
    case "avg":
      return vals.length ? vals.reduce<number>((s, v) => s + num(v), 0) / vals.length : 0;
    case "max":
      return vals.length ? Math.max(...vals.map(num)) : 0;
    case "min":
      return vals.length ? Math.min(...vals.map(num)) : 0;
    case "distinct":
      return new Set(vals.filter((v) => !isBlank(v)).map(String)).size;
  }
}

function resolveKpi(spec: ReportKpiSpec, i: number, result: ReportResult, rows: Row[]): ReportKpi {
  const format: InsightFormat = spec.format ?? "number";
  let value: number;
  if (spec.fromTotals && spec.column && result.totals && result.totals[spec.column] !== undefined) {
    value = num(result.totals[spec.column]);
  } else {
    const w = spec.where;
    const scoped = w
      ? rows.filter((r) => {
          const hit = w.equals.some((e) => sameValue(r[w.column], e));
          return w.not ? !hit : hit;
        })
      : rows;
    value = aggregate(scoped, spec.agg, spec.column);
  }
  return { key: `kpi-${i}`, label: spec.label, value, format, footnote: spec.footnote, tone: spec.tone };
}

/** Label for a grouping value — dates become "05 Oct", blanks become "None". */
function labelOf(v: unknown, dateAxis: boolean): string {
  if (isBlank(v)) return "None";
  if (dateAxis) {
    const d = v instanceof Date ? v : new Date(String(v));
    if (!Number.isNaN(d.getTime())) return formatDateUtc(d, false).slice(0, 6);
  }
  return String(v);
}

function sortKeyOf(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Bucket rows by a column, keeping first-seen order (or chronological order for dates). */
function bucket(rows: Row[], by: string) {
  const map = new Map<string, { label: string; sort: number | null; rows: Row[] }>();
  for (const r of rows) {
    const raw = r[by];
    const sort = sortKeyOf(raw);
    const dateAxis = sort !== null;
    const label = labelOf(raw, dateAxis);
    // Dates bucket by day, not by exact time.
    const key = dateAxis ? new Date(sort!).toISOString().slice(0, 10) : label;
    const b = map.get(key);
    if (b) b.rows.push(r);
    else map.set(key, { label, sort, rows: [r] });
  }
  const out = [...map.values()];
  if (out.length && out.every((b) => b.sort !== null)) out.sort((a, b) => a.sort! - b.sort!);
  return out;
}

/** Keep the biggest `top` buckets and fold the rest into "Other". */
function fold(items: { label: string; value: number }[], top: number) {
  if (items.length <= top) return items;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top - 1);
  const rest = sorted.slice(top - 1).reduce((s, x) => s + x.value, 0);
  return [...head, { label: "Other", value: rest }];
}

function resolveVisual(spec: ReportVisualSpec, rows: Row[]): ReportVisual | null {
  if (rows.length === 0) return null;
  switch (spec.type) {
    case "donut":
    case "ranked": {
      const items = bucket(rows, spec.by).map((b) => ({
        label: b.label,
        value: spec.value ? aggregate(b.rows, "sum", spec.value) : b.rows.length,
      }));
      const shown = fold(items, spec.top ?? (spec.type === "donut" ? 4 : 8)).filter((x) => x.value !== 0);
      if (shown.length === 0) return null;
      const format = spec.format ?? "number";
      if (spec.type === "ranked") {
        return { type: "ranked", title: spec.title, format, rows: [...shown].sort((a, b) => b.value - a.value) };
      }
      return { type: "donut", title: spec.title, format, centerLabel: spec.centerLabel ?? "Total", slices: shown };
    }
    case "column": {
      const measures = (spec.values?.length ? spec.values : [{ label: "Count", agg: "count" as const }]).slice(0, 2);
      const buckets = bucket(rows, spec.by);
      const points = buckets.map((b) => ({
        label: b.label,
        values: measures.map((m) => (m.column ? aggregate(b.rows, m.agg ?? "sum", m.column) : b.rows.length)),
      }));
      const capped = spec.top && points.length > spec.top && buckets.every((b) => b.sort === null)
        ? [...points].sort((a, b) => b.values[0] - a.values[0]).slice(0, spec.top)
        : points;
      return {
        type: "column",
        title: spec.title,
        format: spec.format ?? "number",
        series: measures.map((m, i) => ({ key: `m${i}`, label: m.label })),
        points: capped,
      };
    }
    case "line": {
      const points = bucket(rows, spec.x).map((b) => ({ label: b.label, value: aggregate(b.rows, "sum", spec.y) }));
      if (points.length < 2) return null;
      return { type: "line", title: spec.title, format: spec.format ?? "number", seriesLabel: spec.label ?? spec.title, points };
    }
  }
}

/** Attach `summary` + `visuals` to a result from its def's spec. Never throws: a malformed
 *  spec must cost a report its charts, never the report. */
export function buildInsights(result: ReportResult, spec: ReportInsightsSpec | undefined): ReportResult {
  const rows = allRows(result);

  const summary: ReportKpi[] = [];
  try {
    (spec?.kpis ?? []).forEach((k, i) => summary.push(resolveKpi(k, i, result, rows)));
  } catch (e) {
    console.error("Report KPIs failed", e);
  }

  // A report with no declared KPIs still gets its record count — plus its grand totals.
  if (summary.length === 0) {
    summary.push({ key: "records", label: "Records", value: rows.length, format: "number" });
    if (result.totals) {
      for (const col of result.columns) {
        const v = result.totals[col.key];
        if (v === undefined || v === null || v === "") continue;
        if (col.format !== "currency" && col.format !== "number") continue;
        summary.push({ key: `total-${col.key}`, label: `Total ${col.label}`, value: num(v), format: col.format === "currency" ? "currency" : "number" });
      }
    }
  }

  const visuals: ReportVisual[] = [];
  try {
    for (const v of spec?.visuals ?? []) {
      const r = resolveVisual(v, rows);
      if (r) visuals.push(r);
    }
  } catch (e) {
    console.error("Report visuals failed", e);
  }

  return { ...result, summary: summary.slice(0, 6), visuals };
}

/** Plain-text rendering of a KPI/visual value (screen, PDF and Excel share it). */
export function formatInsight(value: number | string, format: InsightFormat, currency?: string): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency": {
      const s = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return currency ? `${currency} ${s}` : s;
    }
    case "percent":
      return `${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
    case "text":
      return String(value);
    default:
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}
