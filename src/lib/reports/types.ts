import type { AuthContext } from "@/lib/scope";

// ─── The reporting engine's shared contracts ────────────────────────────────
// Every report is one ReportDef in the registry. From its `params` the UI builds
// a parameter form; `run` returns a ReportResult that the PDF/Excel/CSV renderers
// turn into a file. Adding a report = adding one file + registering it; no engine
// changes needed.

// Parameter kinds the parameter form knows how to render.
export type ReportParamType =
  | "date" // single date (defaults to the property business date)
  | "dateRange" // { from, to }
  | "select" // one value
  | "multiSelect" // many values
  | "boolean";

// Where a select/multiSelect's options come from — either static (inline) or a
// named dynamic source resolved per property by /api/reports/options.
export type ReportOptionSource =
  | "roomTypes"
  | "outlets"
  | "travelAgents"
  | "cashiers"
  | "chargeCategories"
  | "reservationStatuses"
  | "traceTypes";

export type ReportParam = {
  key: string;
  label: string;
  type: ReportParamType;
  required?: boolean;
  help?: string;
  // Static option list, or a dynamic source name (mutually exclusive).
  options?: { label: string; value: string }[];
  optionSource?: ReportOptionSource;
  // Sensible default: for date/dateRange, "today" resolves to the business date.
  defaultToday?: boolean;
};

export type ColumnFormat = "text" | "number" | "currency" | "date" | "datetime";

export type ReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: ColumnFormat;
  width?: number; // relative weight for PDF column sizing / Excel width
};

// A report may return flat rows, or rows split into labelled groups (each with an
// optional subtotal row). Totals is a single grand-total row keyed by column.
export type ReportGroup = {
  label: string;
  rows: Record<string, unknown>[];
  subtotals?: Record<string, unknown>;
};

// ─── Insights: the figures and charts shown above the table ─────────────────
// A report declares an `insights` SPEC (plain data, below); `buildInsights` resolves it
// against the report's own rows into `summary` + `visuals` on the result. Everything visual
// is derived from the rows the table shows, so the screen, the PDF and the Excel summary
// can never disagree with each other.
export type InsightFormat = "number" | "currency" | "percent" | "text";

export type ReportKpi = {
  key: string;
  label: string;
  value: number | string;
  format: InsightFormat;
  footnote?: string;
  tone?: "default" | "danger" | "success";
};

export type InsightAgg = "count" | "sum" | "avg" | "max" | "min" | "distinct";

export type ReportKpiSpec = {
  label: string;
  agg: InsightAgg;
  /** The column aggregated. Not needed for "count". */
  column?: string;
  format?: InsightFormat;
  /** Only rows where `column` is one of `equals` (or, with `not`, none of them). */
  where?: { column: string; equals: unknown[]; not?: boolean };
  /** Use the report's grand-total cell for `column` instead of re-summing. */
  fromTotals?: boolean;
  footnote?: string;
  tone?: ReportKpi["tone"];
};

export type ReportVisualSpec =
  // Part-to-whole: share of rows (or of `value`) per `by`.
  | { type: "donut"; title: string; by: string; value?: string; format?: InsightFormat; top?: number; centerLabel?: string }
  // Ranked horizontal bars of `value` (default: count) per `by`.
  | { type: "ranked"; title: string; by: string; value?: string; format?: InsightFormat; top?: number }
  // Columns over a category/date axis; 1–2 measures on one shared scale.
  | { type: "column"; title: string; by: string; values?: { column?: string; label: string; agg?: "sum" | "count" | "avg" }[]; format?: InsightFormat; top?: number }
  // A single measure over an ordered (usually date) axis.
  | { type: "line"; title: string; x: string; y: string; label?: string; format?: InsightFormat };

export type ReportInsightsSpec = { kpis?: ReportKpiSpec[]; visuals?: ReportVisualSpec[] };

/** A visual with its data resolved — what the screen, PDF and Excel actually draw. */
export type ReportVisual =
  | { type: "donut"; title: string; format: InsightFormat; centerLabel: string; slices: { label: string; value: number }[] }
  | { type: "ranked"; title: string; format: InsightFormat; rows: { label: string; value: number }[] }
  | { type: "column"; title: string; format: InsightFormat; series: { key: string; label: string }[]; points: { label: string; values: number[] }[] }
  | { type: "line"; title: string; format: InsightFormat; seriesLabel: string; points: { label: string; value: number }[] };

export type ReportResult = {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows?: Record<string, unknown>[];
  groups?: ReportGroup[];
  totals?: Record<string, unknown>;
  // Free-form note printed under the title (e.g. parameter echo, caveats).
  note?: string;
  // Filled in by buildInsights from the def's `insights` spec (never set by hand).
  summary?: ReportKpi[];
  visuals?: ReportVisual[];
};

export type ReportRunContext = {
  ctx: AuthContext;
  propertyId: string | null; // resolved current/target property (null only for enterprise-wide)
  params: Record<string, unknown>;
};

export type ReportDef = {
  key: string;
  module: "FRONT_DESK" | "RESERVATIONS" | "REVENUE" | "FINANCIAL" | "HOUSEKEEPING" | "TRANSPORTATION";
  name: string;
  description: string;
  params: ReportParam[];
  run: (rc: ReportRunContext) => Promise<ReportResult>;
  // KPIs and charts shown above the table (screen + PDF + Excel summary sheet).
  insights?: ReportInsightsSpec;
  // Replaces the generic styled workbook when the Excel file must match an external
  // template exactly (e.g. the MIRA Green Tax sheet) — no title block, no totals.
  renderXlsx?: (result: ReportResult) => Promise<Buffer>;
};

export type ReportFormat = "pdf" | "xlsx" | "csv" | "txt";

/** What the generate API returns for `format: "json"` — the on-screen preview. */
export type ReportPreview = {
  result: ReportResult;
  branding: Omit<ReportBranding, "generatedAt"> & { generatedAt: string };
};

// Header/branding shown on the rendered document, sourced from the property +
// enterprise invoice-branding settings.
export type ReportBranding = {
  propertyName: string;
  enterpriseName: string;
  currency: string;
  brandColor?: string | null; // hex, e.g. "#4f46e5"
  logoDataUrl?: string | null; // data: URI (PDF embeds bytes; kept optional)
  // The property's logo (Hub › General) — a URL the printed page loads; null for all properties.
  logoUrl?: string | null;
  generatedBy: string;
  generatedAt: Date;
  // IANA zone the "Generated …" stamp is shown in — the property's own clock.
  timeZone?: string | null;
};
