import { prisma } from "@/lib/db";
import { requirePermission, assertPropertyAccess, resolveCurrentPropertyId, type AuthContext } from "@/lib/scope";
import { resolveBusinessDate, serverToday } from "@/lib/business-date";
import { getReport } from "@/lib/reports/registry";
import { coerceParams, missingRequired } from "@/lib/reports/params";
import { loadBranding } from "@/lib/reports/engine";
import type { ReportBranding, ReportDef, ReportResult } from "@/lib/reports/types";

// Resolve, validate and run one report for a signed-in user. Shared by the generate API
// (preview JSON, Excel, CSV, PDF) and the report print page that the PDF is rendered
// from, so all of them see exactly the same data for the same request.

export type ReportRequest = {
  key: string;
  propertyId?: string | null;
  params?: Record<string, unknown>;
};

/** A request the caller got wrong (unknown report, missing parameter) — not a server fault. */
export class ReportRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function runReport(
  ctx: AuthContext,
  req: ReportRequest
): Promise<{ def: ReportDef; result: ReportResult; branding: ReportBranding; propertyId: string | null }> {
  requirePermission(ctx, "REPORTS", "view");

  const def = getReport(String(req.key ?? ""));
  if (!def) throw new ReportRequestError("Unknown report.", 404);

  // Resolve the target property (an enterprise user may pass one; verify access).
  let propertyId: string | null;
  if (req.propertyId) {
    await assertPropertyAccess(ctx, String(req.propertyId));
    propertyId = String(req.propertyId);
  } else {
    propertyId = await resolveCurrentPropertyId(ctx);
  }

  const property = propertyId ? await prisma.property.findUnique({ where: { id: propertyId } }) : null;
  const businessDate = property ? resolveBusinessDate(property) : serverToday();

  const params = coerceParams(def, (req.params ?? {}) as Record<string, unknown>, businessDate);
  const missing = missingRequired(def, params);
  if (missing.length) throw new ReportRequestError(`Missing required parameter(s): ${missing.join(", ")}`, 400);

  const result = await def.run({ ctx, propertyId, params });
  const branding = await loadBranding(ctx, propertyId);
  return { def, result, branding, propertyId };
}

/** Portrait fits up to six columns comfortably; wider reports print landscape. */
export function reportIsLandscape(result: ReportResult): boolean {
  return result.columns.length > 6;
}

// The print page receives the request in its URL. base64url JSON keeps arbitrary param
// values (arrays, ranges) intact without a per-type query-string scheme.
export function encodeReportRequest(req: ReportRequest): string {
  return Buffer.from(JSON.stringify(req), "utf8").toString("base64url");
}

export function decodeReportRequest(encoded: string | null | undefined): ReportRequest | null {
  if (!encoded) return null;
  try {
    const v = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return v && typeof v === "object" && typeof v.key === "string" ? (v as ReportRequest) : null;
  } catch {
    return null;
  }
}
