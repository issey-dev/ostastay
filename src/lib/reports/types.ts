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

export type ReportResult = {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows?: Record<string, unknown>[];
  groups?: ReportGroup[];
  totals?: Record<string, unknown>;
  // Free-form note printed under the title (e.g. parameter echo, caveats).
  note?: string;
};

export type ReportRunContext = {
  ctx: AuthContext;
  propertyId: string | null; // resolved current/target property (null only for enterprise-wide)
  params: Record<string, unknown>;
};

export type ReportDef = {
  key: string;
  module: "FRONT_DESK" | "RESERVATIONS" | "REVENUE" | "FINANCIAL" | "HOUSEKEEPING";
  name: string;
  description: string;
  params: ReportParam[];
  run: (rc: ReportRunContext) => Promise<ReportResult>;
};

export type ReportFormat = "pdf" | "xlsx" | "csv";

// Header/branding shown on the rendered document, sourced from the property +
// enterprise invoice-branding settings.
export type ReportBranding = {
  propertyName: string;
  enterpriseName: string;
  currency: string;
  brandColor?: string | null; // hex, e.g. "#4f46e5"
  logoDataUrl?: string | null; // data: URI (PDF embeds bytes; kept optional)
  generatedBy: string;
  generatedAt: Date;
};
