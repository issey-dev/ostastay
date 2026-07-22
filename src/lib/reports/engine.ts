import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";
import type { ReportBranding, ReportFormat, ReportResult } from "@/lib/reports/types";
import { renderPdf } from "@/lib/reports/render/pdf";
import { renderXlsx } from "@/lib/reports/render/xlsx";
import { renderCsv } from "@/lib/reports/render/csv";

// Build the header/branding block for a rendered report from the property +
// enterprise invoice-branding settings.
export async function loadBranding(ctx: AuthContext, propertyId: string | null): Promise<ReportBranding> {
  const [property, enterprise, settings, user] = await Promise.all([
    propertyId ? prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, defaultCurrency: true } }) : null,
    prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { name: true } }),
    prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId }, select: { invoiceBrandColor: true } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, email: true } }),
  ]);

  return {
    propertyName: property?.name ?? "All properties",
    enterpriseName: enterprise?.name ?? "",
    currency: property?.defaultCurrency ?? "",
    brandColor: settings?.invoiceBrandColor ?? null,
    generatedBy: user ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user as { email?: string } | null)?.email ?? "System",
    generatedAt: new Date(),
  };
}

const SAFE = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

// Render a report result to the requested format, returning the bytes plus the
// HTTP content-type and a download filename.
export async function renderReport(
  key: string,
  result: ReportResult,
  branding: ReportBranding,
  format: ReportFormat
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const base = `${SAFE(key)}-${branding.generatedAt.toISOString().slice(0, 10)}`;
  if (format === "csv") {
    return { body: Buffer.from(renderCsv(result), "utf8"), contentType: "text/csv; charset=utf-8", filename: `${base}.csv` };
  }
  if (format === "xlsx") {
    return {
      body: await renderXlsx(result, branding),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${base}.xlsx`,
    };
  }
  return { body: Buffer.from(await renderPdf(result, branding)), contentType: "application/pdf", filename: `${base}.pdf` };
}
