import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { renderReport, reportFilename } from "@/lib/reports/engine";
import { encodeReportRequest, reportIsLandscape, runReport, ReportRequestError } from "@/lib/reports/run";
import { generateReportPdf } from "@/lib/stationery-pdf";
import type { ReportFormat, ReportPreview } from "@/lib/reports/types";

const FORMATS: (ReportFormat | "json")[] = ["pdf", "xlsx", "csv", "json"];

// Run a report and return it.
// Body: { key, format, propertyId?, params }.
//   format "json"            → { result, branding } for the on-screen Preview
//   format "pdf"             → the print page (the same layout as the Preview) printed by
//                              headless Chrome; the pdf-lib renderer is only a fallback
//   format "xlsx" / "csv"    → the file
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json();
    const format = FORMATS.includes(body.format) ? (body.format as ReportFormat | "json") : "pdf";

    const req = { key: String(body.key ?? ""), propertyId: body.propertyId ? String(body.propertyId) : null, params: body.params ?? {} };
    const { def, result, branding, propertyId } = await runReport(ctx, req);

    if (format === "json") {
      const preview: ReportPreview = { result, branding: { ...branding, generatedAt: branding.generatedAt.toISOString() } };
      return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
    }

    let file = format === "pdf" ? await chromePdf() : null;
    if (!file) file = await renderReport(def, result, branding, format);

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });

    // The PDF is the print page rendered as this same user, so it is exactly what the
    // Preview showed. Null (→ fallback renderer) if Chrome is unavailable on this host —
    // a report download must never fail just because the nicer renderer did.
    async function chromePdf() {
      const authToken = (await cookies()).get("auth_token")?.value;
      const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { slug: true } });
      if (!authToken || !enterprise) return null;
      try {
        const r = encodeReportRequest({ ...req, propertyId });
        const body = await generateReportPdf(`/e/${enterprise.slug}/dashboard/reports/print?r=${r}`, authToken, {
          landscape: reportIsLandscape(result),
          footerLabel: `${result.title} · ${branding.propertyName}`,
        });
        return { body, contentType: "application/pdf", filename: reportFilename(def.key, branding, "pdf") };
      } catch (e) {
        console.error("Report PDF via Chrome failed; using the fallback renderer.", e);
        return null;
      }
    }
  } catch (error) {
    if (error instanceof ReportRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
