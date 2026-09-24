import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, requireEnterpriseHub, toErrorResponse } from "@/lib/scope";
import { encryptSecret } from "@/lib/secret-crypto";
import { logActivity } from "@/lib/activity-log";
import { isFolioStyle } from "@/lib/folio-presentation";

// What is left of the enterprise-wide settings after setup moved per property
// (2026-09-23, .agents/docs/HUB_SETUP_PLAN.md):
//   - SMTP / SFTP — shared by every property (Hub › Email & SFTP);
//   - for the INTERNAL (Osta) enterprise only, its own license-invoice stationery.
// Everything else — document wording, booking-number format, posting defaults, tax,
// cashier defaults, module outlets — belongs to a property: /api/properties/{id}/settings.

// Stored SMTP/SFTP passwords are never sent to the browser — GET (and the PATCH
// response) replace a set password with this sentinel. The settings form round-trips
// the sentinel untouched, and PATCH treats it as "leave the stored value alone", so
// only an actually-typed new password ever overwrites.
const SECRET_MASK = "********";

function redactSecrets<T extends { smtpPassword: string | null; sftpPassword: string | null }>(settings: T): T {
  return {
    ...settings,
    smtpPassword: settings.smtpPassword ? SECRET_MASK : settings.smtpPassword,
    sftpPassword: settings.sftpPassword ? SECRET_MASK : settings.sftpPassword,
  };
}

const TRANSFER_FIELDS = [
  "smtpHost", "smtpPort", "smtpUsername", "smtpPassword", "smtpFromAddress", "smtpUseTls",
  "sftpHost", "sftpPort", "sftpUsername", "sftpPassword", "sftpRemotePath",
] as const;

// Osta's own license-invoice stationery. A customer sets these per property instead.
const OSTA_DOCUMENT_FIELDS = [
  "invoiceBrandName", "invoiceLogoUrl", "invoiceBrandColor", "invoiceFontFamily", "invoiceTaxId",
  "invoicePhone", "invoiceEmail", "invoiceAddress", "defaultFolioStyle",
  "invoiceHeaderText", "invoiceFooterText", "invoicePaymentTerms",
  "invoicePaymentAccountName", "invoicePaymentAccountNumber", "invoicePaymentIban", "invoicePaymentBankInfo",
  "receiptFooterText", "receiptTerms", "statementFooterText", "statementTerms",
  "confirmationLetterMessage", "registrationCardEnabled", "registrationCardMessage", "registrationCardTerms",
  "eRegistrationEnabled", "eRegistrationExpiryHours", "eRegistrationMessage",
] as const;

// Moved to each property — named in the refusal so a stale client says where to go.
const PER_PROPERTY_FIELDS = [
  ...OSTA_DOCUMENT_FIELDS,
  "resConfirmPrefix", "resConfirmLength",
  "defaultAccommodationChargeCodeId", "defaultGreenTaxChargeCodeId", "commissionChargeCodeId",
  "cityLedgerPaymentMethodId", "spaOutletId", "excursionOutletId",
  "cashierDefaultFloat", "exchangeFromCurrency", "exchangeToCurrency",
  "greenTaxEnabled", "greenTaxAdultAmount", "greenTaxChildAmount", "greenTaxStayBasis", "greenTaxExemptAge",
  "tgstEnabled", "tgstRate", "serviceChargeEnabled", "serviceChargeRate",
] as const;

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");
    // Enterprise-wide (SMTP/SFTP): never a single-property admin's, whatever their CONTROLS.
    requireEnterpriseHub(ctx);

    const settings = await prisma.enterpriseSettings.upsert({
      where: { enterpriseId: ctx.enterpriseId },
      update: {},
      create: { enterpriseId: ctx.enterpriseId },
    });
    return NextResponse.json(redactSecrets(settings));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");
    // Enterprise-wide (SMTP/SFTP): never a single-property admin's, whatever their CONTROLS.
    requireEnterpriseHub(ctx);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const perProperty = PER_PROPERTY_FIELDS.filter(
      (f) => body[f] !== undefined && !(ctx.isInternal && (OSTA_DOCUMENT_FIELDS as readonly string[]).includes(f))
    );
    if (perProperty.length > 0) {
      return NextResponse.json(
        { error: `These are set per property now (Hub › the property's own pages): ${perProperty.join(", ")}` },
        { status: 400 }
      );
    }

    // A round-tripped mask means "unchanged" — never store the literal sentinel. A real
    // password the client just entered is encrypted before it reaches the DB (S8); an
    // empty string clears it.
    if (body.smtpPassword === SECRET_MASK) delete body.smtpPassword;
    if (body.sftpPassword === SECRET_MASK) delete body.sftpPassword;
    if (typeof body.smtpPassword === "string" && body.smtpPassword) body.smtpPassword = encryptSecret(body.smtpPassword);
    if (typeof body.sftpPassword === "string" && body.sftpPassword) body.sftpPassword = encryptSecret(body.sftpPassword);

    // A port that isn't a whole number 1–65535 is refused with a readable message; it used
    // to reach the DB as NaN and come back as a bare 500, which the form showed as "Saved".
    for (const key of ["smtpPort", "sftpPort"] as const) {
      const value = body[key];
      if (value === undefined || value === null || value === "") continue;
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return NextResponse.json({ error: `${key === "smtpPort" ? "SMTP" : "SFTP"} port must be a whole number from 1 to 65535` }, { status: 400 });
      }
    }

    const allowed: readonly string[] = ctx.isInternal ? [...TRANSFER_FIELDS, ...OSTA_DOCUMENT_FIELDS] : TRANSFER_FIELDS;
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      const value = body[key];
      if (value === undefined) continue;
      if (key === "smtpPort" || key === "sftpPort") data[key] = value === "" || value === null ? null : Number(value);
      else if (key === "eRegistrationExpiryHours") data[key] = parseInt(String(value)) || 72;
      else if (key === "defaultFolioStyle") { if (isFolioStyle(value)) data[key] = value; }
      else data[key] = value === "" ? null : value;
    }

    const settings = await prisma.enterpriseSettings.upsert({
      where: { enterpriseId: ctx.enterpriseId },
      update: data,
      create: { enterpriseId: ctx.enterpriseId, ...data },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "EnterpriseSettings",
      entityId: settings.id,
      description: `Updated enterprise settings (${Object.keys(data).join(", ") || "nothing"})`,
    });

    return NextResponse.json(redactSecrets(settings));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
