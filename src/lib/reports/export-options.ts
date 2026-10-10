import { z } from "zod";

// What the "Download as" dialog can ask for, validated server-side. Every field is
// optional so a bare `{ format }` request (the old API) keeps working unchanged.

export const DELIMITERS = {
  comma: ",",
  tab: "\t",
  pipe: "|",
  semicolon: ";",
} as const;

export const exportOptionsSchema = z
  .object({
    // PDF
    orientation: z.enum(["auto", "portrait", "landscape"]).default("auto"),
    includeVisuals: z.boolean().default(true),
    // Excel
    includeSummarySheet: z.boolean().default(true),
    // CSV / delimited text
    layout: z.enum(["data", "presentation"]).default("data"),
    delimiter: z.enum(["comma", "tab", "pipe", "semicolon", "custom"]).default("tab"),
    customDelimiter: z.string().max(1).optional(),
    qualifier: z.enum(["needed", "always", "none"]).default("needed"),
    header: z.boolean().default(true),
    encoding: z.enum(["utf8", "utf8bom", "windows1252"]).default("utf8"),
    lineEnding: z.enum(["crlf", "lf"]).default("crlf"),
  })
  .superRefine((o, ctx) => {
    if (o.delimiter === "custom") {
      const d = o.customDelimiter ?? "";
      if (d.length !== 1) ctx.addIssue({ code: "custom", path: ["customDelimiter"], message: "Enter a single character." });
      else if (/["\r\n]/.test(d)) ctx.addIssue({ code: "custom", path: ["customDelimiter"], message: "That character can't be a delimiter." });
    }
  });

export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = exportOptionsSchema.parse({});

/** Parse untrusted options; unknown/invalid input falls back to defaults rather than failing a download. */
export function parseExportOptions(raw: unknown): ExportOptions {
  const r = exportOptionsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_EXPORT_OPTIONS;
}

export function delimiterChar(o: Pick<ExportOptions, "delimiter" | "customDelimiter">): string {
  return o.delimiter === "custom" ? (o.customDelimiter ?? ",") : DELIMITERS[o.delimiter];
}
