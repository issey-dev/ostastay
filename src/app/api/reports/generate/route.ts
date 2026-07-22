import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, serverToday } from "@/lib/business-date";
import { getReport } from "@/lib/reports/registry";
import { coerceParams, missingRequired } from "@/lib/reports/params";
import { loadBranding, renderReport } from "@/lib/reports/engine";
import type { ReportFormat } from "@/lib/reports/types";

const FORMATS: ReportFormat[] = ["pdf", "xlsx", "csv"];

// Run a report and stream back the rendered file.
// Body: { key, format, propertyId?, params }.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REPORTS", "view");

    const body = await request.json();
    const def = getReport(String(body.key ?? ""));
    if (!def) return NextResponse.json({ error: "Unknown report." }, { status: 404 });

    const format: ReportFormat = FORMATS.includes(body.format) ? body.format : "pdf";

    // Resolve the target property (an enterprise user may pass one; verify access).
    let propertyId: string | null;
    if (body.propertyId) {
      await assertPropertyAccess(ctx, String(body.propertyId));
      propertyId = String(body.propertyId);
    } else {
      propertyId = await resolveCurrentPropertyId(ctx);
    }

    const property = propertyId ? await prisma.property.findUnique({ where: { id: propertyId } }) : null;
    const businessDate = property ? resolveBusinessDate(property) : serverToday();

    const params = coerceParams(def, (body.params ?? {}) as Record<string, unknown>, businessDate);
    const missing = missingRequired(def, params);
    if (missing.length) {
      return NextResponse.json({ error: `Missing required parameter(s): ${missing.join(", ")}` }, { status: 400 });
    }

    const result = await def.run({ ctx, propertyId, params });
    const branding = await loadBranding(ctx, propertyId);
    const { body: fileBody, contentType, filename } = await renderReport(def.key, result, branding, format);

    return new NextResponse(new Uint8Array(fileBody), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
