import type { ReportResult } from "@/lib/reports/types";
import { formatCell } from "@/lib/reports/format";

function esc(s: string): string {
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Render a ReportResult to CSV. Groups are flattened with a label row before each
// group and a "Subtotal" row after; a final grand-total row if present.
export function renderCsv(result: ReportResult): string {
  const lines: string[] = [];
  lines.push(esc(result.title));
  if (result.subtitle) lines.push(esc(result.subtitle));
  lines.push("");

  const header = result.columns.map((c) => esc(c.label)).join(",");
  lines.push(header);

  const rowToCsv = (row: Record<string, unknown>) =>
    result.columns.map((c) => esc(formatCell(row[c.key], c.format))).join(",");

  if (result.groups) {
    for (const g of result.groups) {
      lines.push(esc(g.label));
      for (const row of g.rows) lines.push(rowToCsv(row));
      if (g.subtotals) lines.push(esc("Subtotal") + "," + result.columns.slice(1).map((c) => esc(formatCell(g.subtotals![c.key], c.format))).join(","));
    }
  } else {
    for (const row of result.rows ?? []) lines.push(rowToCsv(row));
  }

  if (result.totals) {
    lines.push(esc("Total") + "," + result.columns.slice(1).map((c) => esc(formatCell(result.totals![c.key], c.format))).join(","));
  }

  return lines.join("\n");
}
