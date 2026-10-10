import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";
import type { ReportBranding, ReportDef, ReportFormat, ReportResult } from "@/lib/reports/types";
import { renderPdf } from "@/lib/reports/render/pdf";
import { renderXlsx } from "@/lib/reports/render/xlsx";
import { renderCsv } from "@/lib/reports/render/csv";
import { renderDelimited } from "@/lib/reports/render/delimited";
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from "@/lib/reports/export-options";

// Build the header/branding block for a rendered report from the property + enterprise.
//
// Reports are drawn in the APP's own palette (Crimson OS accent on the paper ramp — see
// report-document.tsx), not EnterpriseSettings.invoiceBrandColor: that colour belongs to
// Osta's licence invoices, and reading it here is what printed operational reports in an
// unrelated indigo. brandColor is therefore left null (the Excel/fallback-PDF renderers
// fall back to Crimson OS).
export async function loadBranding(ctx: AuthContext, propertyId: string | null): Promise<ReportBranding> {
  const [property, enterprise, user] = await Promise.all([
    propertyId ? prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, defaultCurrency: true, timeZone: true, logoUrl: true } }) : null,
    prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, email: true } }),
  ]);

  return {
    propertyName: property?.name ?? "All properties",
    enterpriseName: enterprise?.name ?? "",
    currency: property?.defaultCurrency ?? "",
    brandColor: null,
    logoUrl: property?.logoUrl ?? null,
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
  format: ReportFormat,
  options: Partial<ExportOptions> = {}
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const { key } = def;
  const o: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  if (format === "csv") {
    return { body: renderCsv(result, options), contentType: "text/csv; charset=utf-8", filename: reportFilename(key, branding, "csv") };
  }
  if (format === "txt") {
    return { body: renderDelimited(result, o), contentType: "text/plain; charset=utf-8", filename: reportFilename(key, branding, "txt") };
  }
  if (format === "xlsx") {
    return {
      body: def.renderXlsx ? await def.renderXlsx(result) : await renderXlsx(result, branding, o.includeSummarySheet),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: reportFilename(key, branding, "xlsx"),
    };
  }
  return { body: Buffer.from(await renderPdf(result, branding)), contentType: "application/pdf", filename: reportFilename(key, branding, "pdf") };
}
