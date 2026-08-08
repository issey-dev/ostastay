import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { ReportResult, ReportBranding, ReportColumn } from "@/lib/reports/types";
import { formatCell, isNumericColumn } from "@/lib/reports/format";
import { CRIMSON_OS, OBSIDIAN_BLACK, STEEL_SLATE, COOL_PLATINUM } from "@/lib/brand";

// Hex -> pdf-lib's [0,1] rgb() triple. Used both for the branding fallback below and to
// convert the brand.ts literals (which are hex strings, like everywhere else in the app)
// into the numeric form this renderer needs.
function hexToTriple(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 36;
const ROW_H = 16;
const HEADER_H = 18;

function hexToRgb(hex: string | null | undefined, fallback: [number, number, number]) {
  if (!hex) return rgb(...fallback);
  const h = hex.replace("#", "");
  if (h.length !== 6) return rgb(...fallback);
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// The standard PDF fonts are WinAnsi-only, so map common smart punctuation to
// ASCII and replace anything outside the encodable range with "?" — a guest name
// in a non-Latin script or a stray symbol must never crash report generation.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

// Truncate a string to fit maxWidth at the given font/size, adding an ellipsis.
function fit(text: string, maxWidth: number, font: PDFFont, size: number): string {
  const s = sanitize(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxWidth) t = t.slice(0, -1);
  return t + "...";
}

export async function renderPdf(result: ReportResult, branding: ReportBranding): Promise<Uint8Array> {
  const landscape = result.columns.length > 6;
  const pageW = landscape ? A4.h : A4.w;
  const pageH = landscape ? A4.w : A4.h;
  const usableW = pageW - MARGIN * 2;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const brand = hexToRgb(branding.brandColor, hexToTriple(CRIMSON_OS));
  const muted = rgb(...hexToTriple(STEEL_SLATE));

  // Column x offsets from relative widths.
  const totalWeight = result.columns.reduce((s, c) => s + (c.width ?? 1), 0);
  const colW = result.columns.map((c) => ((c.width ?? 1) / totalWeight) * usableW);
  const colX: number[] = [];
  let acc = MARGIN;
  for (const w of colW) { colX.push(acc); acc += w; }

  let page!: PDFPage;
  let y = 0;

  const cellText = (page: PDFPage, text: string, col: ReportColumn, i: number, yy: number, f: PDFFont, size: number, color = rgb(...hexToTriple(OBSIDIAN_BLACK))) => {
    const pad = 3;
    const maxW = colW[i] - pad * 2;
    const shown = fit(text, maxW, f, size);
    const right = isNumericColumn(col) || col.align === "right";
    const x = right ? colX[i] + colW[i] - pad - f.widthOfTextAtSize(shown, size) : colX[i] + pad;
    page.drawText(shown, { x, y: yy, size, font: f, color });
  };

  const drawColumnHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - HEADER_H + 4, width: usableW, height: HEADER_H, color: brand });
    result.columns.forEach((col, i) => cellText(page, col.label, col, i, y - HEADER_H + 9, bold, 8.5, rgb(...hexToTriple(COOL_PLATINUM))));
    y -= HEADER_H + 4;
  };

  const newPage = (withTitle: boolean) => {
    page = doc.addPage([pageW, pageH]);
    y = pageH - MARGIN;
    if (withTitle) {
      page.drawText(fit(result.title, usableW, bold, 16), { x: MARGIN, y: y - 14, size: 16, font: bold, color: rgb(...hexToTriple(OBSIDIAN_BLACK)) });
      y -= 22;
      page.drawText(fit(`${branding.propertyName} · ${branding.enterpriseName}  ·  Currency: ${branding.currency}`, usableW, font, 9), { x: MARGIN, y: y - 10, size: 9, font, color: muted });
      y -= 14;
      if (result.subtitle) { page.drawText(fit(result.subtitle, usableW, font, 9), { x: MARGIN, y: y - 10, size: 9, font, color: muted }); y -= 14; }
      if (result.note) { page.drawText(fit(result.note, usableW, font, 8), { x: MARGIN, y: y - 9, size: 8, font, color: muted }); y -= 13; }
      y -= 6;
    }
    drawColumnHeader();
  };

  const ensureRoom = () => { if (y < MARGIN + ROW_H + 20) newPage(false); };

  newPage(true);

  const drawRow = (row: Record<string, unknown>, f: PDFFont, size = 8.5, color = rgb(...hexToTriple(OBSIDIAN_BLACK))) => {
    ensureRoom();
    result.columns.forEach((col, i) => cellText(page, formatCell(row[col.key], col.format), col, i, y - 10, f, size, color));
    y -= ROW_H;
  };

  if (result.groups) {
    for (const g of result.groups) {
      ensureRoom();
      page.drawText(fit(g.label, usableW, bold, 9), { x: MARGIN, y: y - 10, size: 9, font: bold, color: brand });
      y -= ROW_H;
      for (const row of g.rows) drawRow(row, font);
      if (g.subtotals) drawRow({ ...g.subtotals, [result.columns[0].key]: "Subtotal" }, bold);
    }
  } else {
    const rows = result.rows ?? [];
    if (rows.length === 0) { ensureRoom(); page.drawText("No records.", { x: MARGIN, y: y - 10, size: 9, font, color: muted }); y -= ROW_H; }
    for (const row of rows) drawRow(row, font);
  }

  if (result.totals) {
    ensureRoom();
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: pageW - MARGIN, y: y + 2 }, thickness: 0.5, color: muted });
    drawRow({ ...result.totals, [result.columns[0].key]: "Total" }, bold);
  }

  // Footers: generated stamp + page numbers.
  const stamp = `${branding.propertyName} · Generated ${branding.generatedAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC by ${branding.generatedBy}`;
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    p.drawText(fit(stamp, usableW - 80, font, 7), { x: MARGIN, y: MARGIN / 2, size: 7, font, color: muted });
    const pn = `Page ${idx + 1} of ${pages.length}`;
    p.drawText(pn, { x: pageW - MARGIN - font.widthOfTextAtSize(pn, 7), y: MARGIN / 2, size: 7, font, color: muted });
  });

  return doc.save();
}
