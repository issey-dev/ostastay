import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding";
import { sendMail, SmtpNotConfiguredError } from "@/lib/mailer";
import { buildInvoiceSummary, type DebtorInvoiceSummary } from "@/lib/debtor-accounts";
import { computeFolioAgingBuckets, totalOutstanding } from "@/lib/debtor-aging";
import { logActivity } from "@/lib/activity-log";
import { primaryEmail } from "@/lib/profile-communications";

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const INVOICE_INCLUDE = {
  lineItems: true,
  // paymentMethod.type is REQUIRED here: buildInvoiceSummary excludes City-Ledger
  // payments from the receivable, and without the type every transfer would read as
  // cash and the account would show as settled. See lib/debtor-accounts.ts.
  payments: { include: { paymentMethod: { select: { type: true } } } },
  reservation: { include: { primaryGuest: true } },
} as const;

// Table-based, inline-styled markup — mirrors send-confirmation/route.ts's approach for
// the same reason (email clients don't support modern CSS), sharing content shape with
// the statement print page but not its Tailwind/JSX markup.
function buildStatementEmailHtml(params: {
  accountName: string;
  arNumber: string | null;
  propertyName: string;
  invoices: DebtorInvoiceSummary[];
  balance: number;
  settings: any;
  brandColor: string;
}): string {
  const { accountName, arNumber, propertyName, invoices, balance, settings, brandColor } = params;
  const brandName = settings?.invoiceBrandName || propertyName;
  const openInvoices = invoices.filter((inv) => inv.isOpen);
  const aging = computeFolioAgingBuckets(
    openInvoices.map((inv) => ({ balance: inv.balance, referenceDate: inv.checkOutDate ?? new Date() }))
  );
  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total, 0);

  const invoiceRows = invoices
    .map(
      (inv) =>
        `<tr><td style="padding: 6px 0; color: #6b7280;">${formatDate(inv.checkOutDate)}</td><td style="padding: 6px 0;">${inv.guestName}${inv.confirmationNo ? ` — ${inv.confirmationNo}` : ""}${!inv.isOpen ? " (Paid)" : ""}</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${inv.total.toFixed(2)}</td></tr>`
    )
    .join("");

  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
  <div style="border-bottom: 3px solid ${brandColor}; padding-bottom: 16px; margin-bottom: 24px;">
    ${settings?.invoiceLogoUrl
      ? `<img src="${settings.invoiceLogoUrl}" alt="${brandName}" style="max-height: 56px; max-width: 220px;" />`
      : `<div style="font-size: 22px; font-weight: bold; color: ${brandColor};">${brandName}</div>`
    }
  </div>

  <p style="font-size: 14px;">Dear ${accountName},</p>

  <p style="font-size: 14px; line-height: 1.6;">
    Please find your account statement with ${brandName} below.
    ${arNumber ? `AR Number: ${arNumber}.` : ""}
  </p>

  <h3 style="font-size: 13px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Open Balance Aging</h3>
  <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
    <tr><td style="padding: 6px 0; color: #6b7280; width: 60%;">Current</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${aging.current.toFixed(2)}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">1-30 days</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${aging["1-30"].toFixed(2)}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">31-60 days</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${aging["31-60"].toFixed(2)}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">61-90 days</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${aging["61-90"].toFixed(2)}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">90+ days</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${aging["90+"].toFixed(2)}</td></tr>
  </table>

  <h3 style="font-size: 13px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Invoices</h3>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px;">
    ${invoiceRows || `<tr><td style="padding: 6px 0; color: #9ca3af;">No invoices billed to this account yet.</td></tr>`}
  </table>

  <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px;">
    <tr><td style="padding: 4px 0; color: #6b7280;">Total Invoiced</td><td style="padding: 4px 0; text-align: right;">${totalInvoiced.toFixed(2)}</td></tr>
    <tr><td style="padding: 4px 0; color: #6b7280;">Open Balance (Aging)</td><td style="padding: 4px 0; text-align: right;">${totalOutstanding(aging).toFixed(2)}</td></tr>
  </table>

  <div style="border-top: 2px solid #1f2937; margin-top: 16px; padding-top: 8px; display: flex; justify-content: space-between; font-size: 16px; font-weight: bold;">
    <span>Balance Due</span>
    <span style="float: right;">${balance.toFixed(2)}</span>
  </div>

  <p style="font-size: 13px; line-height: 1.6; color: #374151; margin-top: 24px;">${settings?.invoicePaymentTerms || ""}</p>

  <div style="border-top: 1px solid #e5e7eb; margin-top: 24px; padding-top: 12px; font-size: 12px; color: #6b7280;">
    ${settings?.invoiceAddress ? `${settings.invoiceAddress}<br/>` : ""}
    ${settings?.invoicePhone ? `${settings.invoicePhone}` : ""}${settings?.invoicePhone && settings?.invoiceEmail ? " &middot; " : ""}${settings?.invoiceEmail || ""}
  </div>
</div>`.trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "DEBTORS", "view");

    const { profileId } = await params;
    const body = await request.json();
    const propertyId = body.propertyId;
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const profile = await prisma.profile.findUnique({ where: { upid: profileId }, include: { communications: true } });
    if (!profile || profile.enterpriseId !== ctx.enterpriseId || !profile.isCreditAccount) {
      return NextResponse.json({ error: "Credit account not found" }, { status: 404 });
    }

    const accountEmail = primaryEmail(profile.communications);
    if (!accountEmail) {
      return NextResponse.json({ error: "This account has no email address on file." }, { status: 400 });
    }

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const folios = await prisma.folio.findMany({
      where: { propertyId, payeeProfileId: profileId, isDebtorAccount: true },
      include: INVOICE_INCLUDE,
      orderBy: { reservation: { checkOutDate: "desc" } },
    });
    const invoices = folios.map(buildInvoiceSummary);
    const balance = invoices.filter((inv) => inv.isOpen).reduce((sum, inv) => sum + inv.balance, 0);

    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId } });
    const brandColor = resolveInvoiceBrandColor(settings?.invoiceBrandColor ?? null);
    const accountName = profile.companyName || `${profile.firstName} ${profile.lastName || ""}`.trim();

    const html = buildStatementEmailHtml({
      accountName,
      arNumber: profile.arNumber,
      propertyName: property.name,
      invoices,
      balance,
      settings,
      brandColor,
    });

    try {
      await sendMail({
        settings: settings ?? { smtpHost: null, smtpPort: null, smtpUsername: null, smtpPassword: null, smtpFromAddress: null, smtpUseTls: true },
        to: accountEmail,
        subject: `Account Statement — ${accountName} | ${property.name}`,
        html,
      });
    } catch (mailError) {
      if (mailError instanceof SmtpNotConfiguredError) {
        return NextResponse.json({ error: mailError.message }, { status: 400 });
      }
      console.error("Failed to send account statement email:", mailError);
      return NextResponse.json(
        { error: "Failed to send the statement email — check the SMTP settings and try again." },
        { status: 502 }
      );
    }

    await logActivity({
      ctx,
      module: "DEBTORS",
      action: "SEND_STATEMENT",
      entityType: "Profile",
      entityId: profile.upid,
      description: `Emailed account statement for "${accountName}" to ${accountEmail}`,
    });

    return NextResponse.json({ success: true, sentTo: accountEmail });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
