import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { MAIL_SENDER, MAIL_STATUS, PLATFORM_EMAIL_ADDON } from "@/lib/mail-sender";

// Billable email usage per enterprise, for a period — the figure an Uppsolut Mail Service
// line on a LicenseInvoice is written from.
//
// It REPORTS, it does not price. Every LicenseInvoice amount in this product is set by
// hand (owner decision: "no formula"), so inventing a rate here would put a second,
// invisible pricing model next to the real one. This gives the operator the counts; what
// they charge for them stays their call.
//
// Only PLATFORM rows are billable. An enterprise sending through its own SMTP costs us
// nothing, and Uppsolut's own mail to a tenant (handover credentials, channel alerts) is
// ours — those are counted separately so a total can be sanity-checked, never billed.
const OWN_MAIL_KINDS = ["enterprise-welcome", "channel-alert"];

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view email usage");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    // Default window: the current calendar month, which is the billing period.
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = parseDate(searchParams.get("from"), defaultFrom);
    const to = parseDate(searchParams.get("to"), now);

    const [logs, enterprises, addonRows] = await Promise.all([
      prisma.emailLog.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { enterpriseId: true, sender: true, kind: true, status: true },
      }),
      prisma.enterprise.findMany({
        where: { type: "STANDARD" },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      }),
      prisma.enterpriseAddonAccess.findMany({
        where: { module: PLATFORM_EMAIL_ADDON, enabled: true },
        select: { enterpriseId: true },
      }),
    ]);

    const onMailService = new Set(addonRows.map((r) => r.enterpriseId));

    type Row = {
      enterpriseId: string;
      enterpriseName: string;
      slug: string;
      onMailService: boolean;
      billableSent: number;
      billableFailed: number;
      ownSmtpSent: number;
      uppsolutOwnMail: number;
      byKind: Record<string, number>;
    };

    const rows = new Map<string, Row>(
      enterprises.map((e) => [
        e.id,
        {
          enterpriseId: e.id,
          enterpriseName: e.name,
          slug: e.slug,
          onMailService: onMailService.has(e.id),
          billableSent: 0,
          billableFailed: 0,
          ownSmtpSent: 0,
          uppsolutOwnMail: 0,
          byKind: {},
        },
      ])
    );

    for (const log of logs) {
      if (!log.enterpriseId) continue;
      const row = rows.get(log.enterpriseId);
      if (!row) continue;

      if (log.sender === MAIL_SENDER.TENANT) {
        if (log.status === MAIL_STATUS.SENT) row.ownSmtpSent += 1;
        continue;
      }

      // PLATFORM. Uppsolut's own mail about this tenant is never charged to them.
      if (OWN_MAIL_KINDS.includes(log.kind)) {
        row.uppsolutOwnMail += 1;
        continue;
      }

      if (log.status === MAIL_STATUS.SENT) {
        row.billableSent += 1;
        row.byKind[log.kind] = (row.byKind[log.kind] ?? 0) + 1;
      } else {
        // Counted and shown, never billed — we did not deliver it.
        row.billableFailed += 1;
      }
    }

    const result = Array.from(rows.values()).sort(
      (a, b) => b.billableSent - a.billableSent || a.enterpriseName.localeCompare(b.enterpriseName)
    );

    return NextResponse.json({
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      totals: {
        billableSent: result.reduce((n, r) => n + r.billableSent, 0),
        billableFailed: result.reduce((n, r) => n + r.billableFailed, 0),
        ownSmtpSent: result.reduce((n, r) => n + r.ownSmtpSent, 0),
        uppsolutOwnMail: result.reduce((n, r) => n + r.uppsolutOwnMail, 0),
      },
      enterprises: result,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
