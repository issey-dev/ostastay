import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";
import type { ReportBranding, ReportDef, ReportFormat, ReportResult } from "@/lib/reports/types";
import { renderPdf } from "@/lib/reports/render/pdf";
import { renderXlsx } from "@/lib/reports/render/xlsx";
import { renderCsv } from "@/lib/reports/render/csv";

// Build the header/branding block for a rendered report from the property + enterprise.
//
// Reports are drawn in the APP's own palette (Crimson OS accent on the paper ramp — see
// report-document.tsx), not EnterpriseSettings.invoiceBrandColor: that colour belongs to
// Osta's licence invoices, and reading it here is what printed operational reports in an
// unrelated indigo. brandColor is therefore left null (the Excel/fallback-PDF renderers
// fall back to Crimson OS).
export async function loadBranding(ctx: AuthContext, propertyId: string | null): Promise<ReportBranding> {
  const [property, enterprise, user] = await Promise.all([
    propertyId ? prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, defaultCurrency: true, timeZone: true } }) : null,
    prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, email: true } }),
  ]);

  return {
    propertyName: property?.name ?? "All properties",
    enterpriseName: enterprise?.name ?? "",
    currency: property?.defaultCurrency ?? "",
    brandColor: null,
    generatedBy: user ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user as { email?: string } | null)?.email ?? "System",
    generatedAt: new Date(),
    timeZone: property?.timeZone ?? null,
  };
}

const SAFE = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

/** Download name for a report file, e.g. "fd-arrivals-2026-09-23.pdf". */
export function reportFilename(key: string, branding: ReportBranding, ext: string): string {
  return `${SAFE(key)}-${branding.generatedAt.toISOString().slice(0, 10)}.${ext}`;
}

// Render a report result to the requested format, returning the bytes plus the
// HTTP content-type and a download filename.
export async function renderReport(
  def: Pick<ReportDef, "key" | "renderXlsx">,
  result: ReportResult,
  branding: ReportBranding,
  format: ReportFormat
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const { key } = def;
  if (format === "csv") {
    return { body: Buffer.from(renderCsv(result), "utf8"), contentType: "text/csv; charset=utf-8", filename: reportFilename(key, branding, "csv") };
  }
  if (format === "xlsx") {
    return {
      body: def.renderXlsx ? await def.renderXlsx(result) : await renderXlsx(result, branding),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: reportFilename(key, branding, "xlsx"),
    };
  }
  return { body: Buffer.from(await renderPdf(result, branding)), contentType: "application/pdf", filename: reportFilename(key, branding, "pdf") };
}
