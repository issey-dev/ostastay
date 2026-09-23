import ExcelJS from "exceljs";
import type { ReportResult } from "@/lib/reports/types";

// The MIRA Green Tax information sheet, cell for cell as the government template
// (GRTInfoSheet25.1): header on row 1, one guest per row from row 2, real Excel
// dates/times in the template's own number formats — nothing else on the sheet, so the
// file can be submitted as-is. Column keys match the fin-green-tax report rows.
const SHEET_NAME = "GRTInfoSheet25.1";

type Col = { key: string; header: string; width: number; kind: "int" | "text" | "date" | "time"; numFmt?: string };
const COLUMNS: Col[] = [
  { key: "regNo", header: "Guest Registration No.", width: 12.66, kind: "int", numFmt: "0_);(0)" },
  { key: "guest", header: "Name of Guest", width: 36, kind: "text" },
  { key: "category", header: "Category", width: 14.44, kind: "int", numFmt: "#,##0" },
  // The template formats Date of birth month-first and the stay dates day-first.
  { key: "dob", header: "Date of birth", width: 18.33, kind: "date", numFmt: " mm/dd/yyyy" },
  { key: "idNo", header: "Identification No.", width: 20.66, kind: "text" },
  { key: "nationality", header: "Nationality", width: 28, kind: "text" },
  { key: "bookingMethod", header: "Booking Method", width: 21.66, kind: "text" },
  { key: "checkInDate", header: "Check-in Date", width: 18.33, kind: "date", numFmt: " dd/mm/yyyy" },
  { key: "checkInTime", header: "Check-in Time", width: 18.66, kind: "time", numFmt: "hh:mm:ss " },
  { key: "checkOutDate", header: "Check-out Date", width: 19.11, kind: "date", numFmt: " dd/mm/yyyy" },
  { key: "checkOutTime", header: "Check-out Time", width: 17, kind: "time", numFmt: "hh:mm:ss " },
];

function cellValue(value: unknown, col: Col): ExcelJS.CellValue {
  if (value === null || value === undefined || value === "") return null;
  switch (col.kind) {
    case "int":
      return typeof value === "number" ? value : Number(value);
    case "date": {
      // Dates here are UTC midnights; exceljs writes a Date by its UTC value.
      const d = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case "time": {
      // "HH:mm" → Excel time-of-day serial (fraction of a day).
      const [h, m] = String(value).split(":").map(Number);
      return Number.isFinite(h) ? (h * 60 + (m || 0)) / 1440 : null;
    }
    default:
      return String(value);
  }
}

export async function renderGreenTaxXlsx(result: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME);

  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const header = ws.getRow(1);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });
  header.commit();

  (result.rows ?? []).forEach((row, r) => {
    const xr = ws.getRow(r + 2);
    COLUMNS.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      cell.value = cellValue(row[c.key], c);
      if (c.numFmt) cell.numFmt = c.numFmt;
    });
    xr.commit();
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
