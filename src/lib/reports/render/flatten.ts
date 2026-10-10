import type { ReportColumn, ReportResult } from "@/lib/reports/types";
import { formatCell, guardFormula } from "@/lib/reports/format";

// A report as a plain grid of strings — the shared first step of CSV and delimited text.
//
//  · "data" layout (default): ONE header row, one row per record, nothing else. Group names
//    become a leading "Group" column, numbers are raw (no thousands separators), dates are
//    ISO. This is what another system wants to import.
//  · "presentation" layout: the file as it always was — title, subtitle, group heading
//    rows, subtotals, grand total, display-formatted values.

function rawCell(value: unknown, col: ReportColumn): string {
  if (value === null || value === undefined || value === "") return "";
  if (col.format === "date" || col.format === "datetime") {
    const d = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(d.getTime())) return col.format === "date" ? d.toISOString().slice(0, 10) : d.toISOString();
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const s = String(value);
  // Numbers kept as strings upstream stay as they are; only free text needs the guard.
  return col.format === "number" || col.format === "currency" ? s : guardFormula(s);
}

export function flattenResult(result: ReportResult, layout: "data" | "presentation"): string[][] {
  const cols = result.columns;
  const out: string[][] = [];

  if (layout === "data") {
    const grouped = !!result.groups;
    out.push([...(grouped ? ["Group"] : []), ...cols.map((c) => c.label)]);
    if (result.groups) {
      for (const g of result.groups) for (const row of g.rows) out.push([g.label, ...cols.map((c) => rawCell(row[c.key], c))]);
    } else {
      for (const row of result.rows ?? []) out.push(cols.map((c) => rawCell(row[c.key], c)));
    }
    return out;
  }

  const fmt = (row: Record<string, unknown>) =>
    cols.map((c) => {
      const s = formatCell(row[c.key], c.format);
      return c.format === "number" || c.format === "currency" ? s : guardFormula(s);
    });
  out.push([result.title]);
  if (result.subtitle) out.push([result.subtitle]);
  out.push([]);
  out.push(cols.map((c) => c.label));
  if (result.groups) {
    for (const g of result.groups) {
      out.push([g.label]);
      for (const row of g.rows) out.push(fmt(row));
      if (g.subtotals) out.push(fmt({ ...g.subtotals, [cols[0].key]: "Subtotal" }));
    }
  } else {
    for (const row of result.rows ?? []) out.push(fmt(row));
  }
  if (result.totals) out.push(fmt({ ...result.totals, [cols[0].key]: "Total" }));
  return out;
}
