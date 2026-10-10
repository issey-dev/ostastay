import ExcelJS from "exceljs";
import type { ReportResult, ReportBranding, ReportColumn } from "@/lib/reports/types";
import { excelNumFmt, guardFormula, isNumericColumn } from "@/lib/reports/format";
import { formatInsight } from "@/lib/reports/insights";
import { CRIMSON_OS, OBSIDIAN_BLACK, STEEL_SLATE } from "@/lib/brand";

function argb(hex: string | null | undefined, fallback: string): string {
  const h = (hex ?? fallback).replace("#", "");
  return `FF${h.toUpperCase().padStart(6, "0").slice(0, 6)}`;
}

// Hex -> exceljs's ARGB string ("FF" alpha + 6-digit hex), for the brand.ts literals.
function brandArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

// Coerce a cell into an Excel-native value (numbers stay numbers so totals/filters work).
function cellValue(value: unknown, col: ReportColumn): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (isNumericColumn(col)) return typeof value === "number" ? value : Number(value) || 0;
  if ((col.format === "date" || col.format === "datetime") && (value instanceof Date || typeof value === "string")) {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return guardFormula(String(value));
}

// Render a ReportResult to a styled .xlsx workbook: the data sheet, plus (when the report
// has KPIs or charts) a Summary sheet carrying the same figures the screen shows.
export async function renderXlsx(result: ReportResult, branding: ReportBranding, includeSummary = true): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = branding.enterpriseName;
  wb.created = branding.generatedAt;
  const ws = wb.addWorksheet(result.title.slice(0, 28) || "Report");

  const colCount = result.columns.length;
  const brand = argb(branding.brandColor, CRIMSON_OS);

  // Title block
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = result.title;
  titleCell.font = { bold: true, size: 16, color: { argb: brandArgb(OBSIDIAN_BLACK) } };

  ws.mergeCells(2, 1, 2, colCount);
  ws.getCell(2, 1).value = `${branding.propertyName} · ${branding.enterpriseName}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: brandArgb(STEEL_SLATE) } };

  let r = 3;
  if (result.subtitle) {
    ws.mergeCells(r, 1, r, colCount);
    ws.getCell(r, 1).value = result.subtitle;
    ws.getCell(r, 1).font = { size: 10, color: { argb: brandArgb(STEEL_SLATE) } };
    r++;
  }
  r++; // blank spacer row

  // Header row
  const headerRow = ws.getRow(r);
  result.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } };
    cell.alignment = { horizontal: col.align ?? (isNumericColumn(col) ? "right" : "left") };
  });
  headerRow.commit();
  r++;

  const writeDataRow = (row: Record<string, unknown>, bold = false) => {
    const xr = ws.getRow(r);
    result.columns.forEach((col, i) => {
      const cell = xr.getCell(i + 1);
      cell.value = cellValue(row[col.key], col);
      const numFmt = excelNumFmt(col.format);
      if (numFmt) cell.numFmt = numFmt;
      cell.alignment = { horizontal: col.align ?? (isNumericColumn(col) ? "right" : "left") };
      if (bold) cell.font = { bold: true };
    });
    xr.commit();
    r++;
  };

  if (result.groups) {
    for (const g of result.groups) {
      const gr = ws.getRow(r);
      gr.getCell(1).value = g.label;
      gr.getCell(1).font = { bold: true, italic: true };
      gr.commit();
      r++;
      for (const row of g.rows) writeDataRow(row);
      if (g.subtotals) writeDataRow({ ...g.subtotals, [result.columns[0].key]: "Subtotal" }, true);
    }
  } else {
    for (const row of result.rows ?? []) writeDataRow(row);
  }

  if (result.totals) {
    writeDataRow({ ...result.totals, [result.columns[0].key]: "Total" }, true);
  }

  // Column widths
  result.columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = Math.min(48, Math.max(12, (col.width ?? col.label.length + 4)));
  });

  if (includeSummary && ((result.summary?.length ?? 0) > 0 || (result.visuals?.length ?? 0) > 0)) {
    addSummarySheet(wb, result, branding, brand);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// The Summary sheet: KPI table, then each chart's numbers as a small table (Excel users
// can chart them natively; we deliberately don't embed images that go stale on edit).
function addSummarySheet(wb: ExcelJS.Workbook, result: ReportResult, branding: ReportBranding, brand: string) {
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  let r = 1;
  ws.getCell(r, 1).value = result.title;
  ws.getCell(r, 1).font = { bold: true, size: 14, color: { argb: brandArgb(OBSIDIAN_BLACK) } };
  r++;
  ws.getCell(r, 1).value = [result.subtitle, `${branding.propertyName}${branding.currency ? ` · ${branding.currency}` : ""}`].filter(Boolean).join(" · ");
  ws.getCell(r, 1).font = { size: 10, color: { argb: brandArgb(STEEL_SLATE) } };
  r += 2;

  const head = (row: number, labels: string[]) =>
    labels.forEach((l, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = l;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } };
      if (i > 0) c.alignment = { horizontal: "right" };
    });

  if (result.summary?.length) {
    head(r, ["Key figures", "Value"]);
    r++;
    for (const k of result.summary) {
      ws.getCell(r, 1).value = k.label;
      const c = ws.getCell(r, 2);
      if (typeof k.value === "number" && k.format !== "text") {
        c.value = k.value;
        c.numFmt = k.format === "currency" ? "#,##0.00" : k.format === "percent" ? '0.0"%"' : "#,##0.##";
      } else {
        c.value = formatInsight(k.value, k.format);
      }
      c.alignment = { horizontal: "right" };
      r++;
    }
    r++;
  }

  for (const v of result.visuals ?? []) {
    const numFmt = v.format === "currency" ? "#,##0.00" : v.format === "percent" ? '0.0"%"' : "#,##0.##";
    if (v.type === "column") {
      head(r, [v.title, ...v.series.map((s) => s.label)]);
      r++;
      for (const p of v.points) {
        ws.getCell(r, 1).value = guardFormula(p.label);
        p.values.forEach((val, i) => {
          const c = ws.getCell(r, i + 2);
          c.value = val;
          c.numFmt = numFmt;
        });
        r++;
      }
    } else {
      head(r, [v.title, v.type === "line" ? v.seriesLabel : "Value"]);
      r++;
      const items = v.type === "donut" ? v.slices : v.type === "ranked" ? v.rows : v.points.map((p) => ({ label: p.label, value: p.value }));
      for (const it of items) {
        ws.getCell(r, 1).value = guardFormula(it.label);
        const c = ws.getCell(r, 2);
        c.value = it.value;
        c.numFmt = numFmt;
        r++;
      }
    }
    r++;
  }
}
