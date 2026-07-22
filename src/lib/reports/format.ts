import type { ColumnFormat, ReportColumn } from "@/lib/reports/types";

// Turn a raw cell value into the display string for a given column format. Kept
// in one place so PDF / Excel / CSV render identically. Currency is rendered as a
// plain grouped number (no symbol) — the property currency is shown in the header.
export function formatCell(value: unknown, format: ColumnFormat | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  switch (format) {
    case "number":
      return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value);
    case "currency":
      return typeof value === "number"
        ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : String(value);
    case "date":
      return formatDateUtc(value, false);
    case "datetime":
      return formatDateUtc(value, true);
    default:
      return String(value);
  }
}

// UTC-safe date formatting (business dates and reservation dates are UTC midnights).
export function formatDateUtc(value: unknown, withTime: boolean): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date} ${time}`;
}

// The Excel number format string for a column (used by exceljs numFmt).
export function excelNumFmt(format: ColumnFormat | undefined): string | undefined {
  if (format === "currency") return "#,##0.00";
  if (format === "number") return "#,##0.##";
  return undefined;
}

export function isNumericColumn(col: ReportColumn): boolean {
  return col.format === "currency" || col.format === "number";
}
