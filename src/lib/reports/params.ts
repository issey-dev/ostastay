import { toUtcMidnight } from "@/lib/business-date";
import type { ReportDef } from "@/lib/reports/types";

// Coerce the raw params object from the client into typed values the report's
// run() expects, applying business-date defaults for date params.
export function coerceParams(
  def: ReportDef,
  raw: Record<string, unknown>,
  businessDate: Date
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.params) {
    const v = raw[p.key];
    switch (p.type) {
      case "date": {
        out[p.key] = v ? toUtcMidnight(new Date(String(v))) : p.defaultToday ? businessDate : null;
        break;
      }
      case "dateRange": {
        const range = (v ?? {}) as { from?: string; to?: string };
        const from = range.from ? toUtcMidnight(new Date(range.from)) : p.defaultToday ? businessDate : null;
        const to = range.to ? toUtcMidnight(new Date(range.to)) : p.defaultToday ? businessDate : null;
        out[p.key] = { from, to };
        break;
      }
      case "multiSelect": {
        out[p.key] = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
        break;
      }
      case "boolean": {
        out[p.key] = v === true || v === "true";
        break;
      }
      default: {
        out[p.key] = v == null || v === "" ? null : String(v);
      }
    }
  }
  return out;
}

// Validate that all required params are present after coercion.
export function missingRequired(def: ReportDef, params: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const p of def.params) {
    if (!p.required) continue;
    const v = params[p.key];
    if (p.type === "dateRange") {
      const r = v as { from?: unknown; to?: unknown };
      if (!r?.from || !r?.to) missing.push(p.label);
    } else if (p.type === "multiSelect") {
      if (!Array.isArray(v) || v.length === 0) missing.push(p.label);
    } else if (v === null || v === undefined || v === "") {
      missing.push(p.label);
    }
  }
  return missing;
}

// A little date helpers used by many reports.
export function dayRange(d: Date): { gte: Date; lt: Date } {
  const start = toUtcMidnight(d);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}
export function rangeBounds(from: Date, to: Date): { gte: Date; lt: Date } {
  return { gte: toUtcMidnight(from), lt: new Date(toUtcMidnight(to).getTime() + 86_400_000) };
}
