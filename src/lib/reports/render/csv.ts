import type { ReportResult } from "@/lib/reports/types";
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from "@/lib/reports/export-options";
import { renderDelimited } from "@/lib/reports/render/delimited";

// CSV is delimited text with a comma. The default layout is machine-readable (one header
// row, raw values); pass layout "presentation" for the old title-and-subtotals shape.
export function renderCsv(result: ReportResult, options?: Partial<ExportOptions>): Buffer {
  return renderDelimited(result, {
    ...DEFAULT_EXPORT_OPTIONS,
    ...options,
    delimiter: "comma",
    // Excel opens a BOM-less UTF-8 CSV as ANSI and mangles accented names, so CSV defaults to the BOM.
    encoding: options?.encoding ?? "utf8bom",
  });
}
