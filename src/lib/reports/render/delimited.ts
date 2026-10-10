import type { ReportResult } from "@/lib/reports/types";
import { delimiterChar, type ExportOptions } from "@/lib/reports/export-options";
import { flattenResult } from "@/lib/reports/render/flatten";

// Delimited text (.txt / .csv): the grid from flattenResult, serialised per the options the
// Download dialog sent. One implementation — CSV is just this with a comma.

// Windows-1252 differs from Latin-1 only in 0x80–0x9F; these are the characters that
// actually turn up in guest/company names and currency symbols.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function encodeText(text: string, encoding: ExportOptions["encoding"]): Buffer {
  if (encoding === "windows1252") {
    const bytes = Array.from(text).map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) return cp;
      return CP1252[cp] ?? 0x3f; // "?" for anything the code page can't hold
    });
    return Buffer.from(bytes);
  }
  const body = Buffer.from(text, "utf8");
  return encoding === "utf8bom" ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

export function serializeDelimited(grid: string[][], o: ExportOptions): string {
  const d = delimiterChar(o);
  const eol = o.lineEnding === "crlf" ? "\r\n" : "\n";
  const cell = (s: string) => {
    if (o.qualifier === "none") {
      // No qualifier: a delimiter or line break inside a value would corrupt the row, so
      // flatten them to a space instead.
      return s.split(d).join(" ").replace(/[\r\n]+/g, " ");
    }
    const needs = o.qualifier === "always" || s.includes(d) || s.includes('"') || /[\r\n]/.test(s);
    return needs ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = o.layout === "data" && !o.header ? grid.slice(1) : grid;
  return rows.map((r) => r.map(cell).join(d)).join(eol) + (rows.length ? eol : "");
}

export function renderDelimited(result: ReportResult, o: ExportOptions): Buffer {
  const text = serializeDelimited(flattenResult(result, o.layout), o);
  return encodeText(text, o.encoding);
}
