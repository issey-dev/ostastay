import { z } from "zod"
import type { Prisma, PropertySettings } from "@prisma/client"
import { prisma } from "@/lib/db"
import { FOLIO_STYLES } from "@/lib/folio-presentation"

// One property's document content and booking-number format (PropertySettings). Every
// reader goes through getPropertySettings() so a property that has never saved anything
// still gets complete, typed defaults — nothing downstream handles a missing row.
// See .agents/docs/HUB_SETUP_PLAN.md (Phase 1).

export type PropertySettingsValues = Omit<PropertySettings, "id" | "propertyId" | "updatedAt">

export const PROPERTY_SETTINGS_DEFAULTS: PropertySettingsValues = {
  resConfirmPrefix: "",
  resConfirmLength: 6,
  defaultFolioStyle: "detailed",
  invoiceHeaderText: null,
  invoiceFooterText: null,
  invoicePaymentTerms: null,
  invoicePaymentAccountName: null,
  invoicePaymentAccountNumber: null,
  invoicePaymentIban: null,
  invoicePaymentBankInfo: null,
  receiptFooterText: null,
  receiptTerms: null,
  statementFooterText: null,
  statementTerms: null,
  confirmationLetterMessage: null,
  registrationCardEnabled: true,
  registrationCardMessage: null,
  registrationCardTerms: null,
  eRegistrationEnabled: true,
  eRegistrationExpiryHours: 72,
  eRegistrationMessage: null,
  // Phase 2 — posting, tax and cashiering
  defaultAccommodationChargeCodeId: null,
  defaultGreenTaxChargeCodeId: null,
  commissionChargeCodeId: null,
  cityLedgerPaymentMethodId: null,
  spaOutletId: null,
  excursionOutletId: null,
  cashierDefaultFloat: 300,
  exchangeFromCurrency: "USD",
  exchangeToCurrency: "MVR",
  greenTaxEnabled: true,
  greenTaxAdultAmount: 12,
  greenTaxChildAmount: 6,
  greenTaxStayBasis: "ACTUAL",
  greenTaxExemptAge: 2,
  tgstEnabled: true,
  tgstRate: 17,
  serviceChargeEnabled: true,
  serviceChargeRate: 10,
  // Night Audit — no-shows and the scheduled run
  noShowTiming: "FIRST_AUDIT",
  noShowPostFee: true,
  autoAuditEnabled: false,
  autoAuditTime: "02:00",
}

type Db = Prisma.TransactionClient | typeof prisma

export async function getPropertySettings(propertyId: string, db: Db = prisma): Promise<PropertySettingsValues> {
  const row = await db.propertySettings.findUnique({ where: { propertyId } })
  if (!row) return { ...PROPERTY_SETTINGS_DEFAULTS }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, propertyId: _p, updatedAt, ...values } = row
  return values
}

// Empty strings are stored as null so "cleared" and "never set" read the same everywhere.
const text = (max: number) =>
  z
    .string()
    .max(max, `Keep this under ${max} characters`)
    .nullable()
    .transform((v) => (v === null || v.trim() === "" ? null : v))

// An id pointer: a non-empty string, or null / "" to clear it.
const pointer = z
  .string()
  .nullable()
  .transform((v) => (v === null || v.trim() === "" ? null : v))
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,8}$/, "Use a currency code like USD or MVR")
const money = z.coerce.number().min(0, "Can't be negative").max(100_000, "That amount looks too large")
const percent = z.coerce.number().min(0, "Can't be negative").max(100, "At most 100%")

// When Night Audit marks a never-arrived reservation as a No-Show — see PropertySettings.
export const NO_SHOW_TIMINGS = ["FIRST_AUDIT", "SECOND_AUDIT", "MANUAL"] as const
export type NoShowTiming = (typeof NO_SHOW_TIMINGS)[number]

// The PATCH body: every field optional, validated on its own.
export const propertySettingsPatchSchema = z
  .object({
    resConfirmPrefix: z
      .string()
      .max(12, "Keep the prefix to 12 characters or fewer")
      .regex(/^[A-Za-z0-9-_/]*$/, "Letters, numbers, - _ / only"),
    resConfirmLength: z.coerce.number().int().min(3, "At least 3 digits").max(12, "At most 12 digits"),
    defaultFolioStyle: z.enum(FOLIO_STYLES),
    invoiceHeaderText: text(500),
    invoiceFooterText: text(2000),
    invoicePaymentTerms: text(2000),
    invoicePaymentAccountName: text(200),
    invoicePaymentAccountNumber: text(100),
    invoicePaymentIban: text(100),
    invoicePaymentBankInfo: text(1000),
    receiptFooterText: text(2000),
    receiptTerms: text(2000),
    statementFooterText: text(2000),
    statementTerms: text(2000),
    confirmationLetterMessage: text(4000),
    registrationCardEnabled: z.boolean(),
    registrationCardMessage: text(1000),
    registrationCardTerms: text(4000),
    eRegistrationEnabled: z.boolean(),
    eRegistrationExpiryHours: z.coerce.number().int().min(1, "At least 1 hour").max(24 * 30, "At most 30 days"),
    eRegistrationMessage: text(2000),

    // Phase 2 — pointers are checked against THIS property's own records in the route
    // (assertSettingsPointersOwned), never trusted from the body.
    defaultAccommodationChargeCodeId: pointer,
    defaultGreenTaxChargeCodeId: pointer,
    commissionChargeCodeId: pointer,
    cityLedgerPaymentMethodId: pointer,
    spaOutletId: pointer,
    excursionOutletId: pointer,
    cashierDefaultFloat: z.coerce.number().min(0, "Can't be negative").max(1_000_000, "That float looks too large"),
    exchangeFromCurrency: currency,
    exchangeToCurrency: currency,
    greenTaxEnabled: z.boolean(),
    greenTaxAdultAmount: money,
    greenTaxChildAmount: money,
    greenTaxStayBasis: z.enum(["ACTUAL", "STANDARD"]),
    greenTaxExemptAge: z.coerce.number().int().min(0).max(18, "Exempt age above 18 isn't a child"),
    tgstEnabled: z.boolean(),
    tgstRate: percent,
    serviceChargeEnabled: z.boolean(),
    serviceChargeRate: percent,
    noShowTiming: z.enum(NO_SHOW_TIMINGS),
    noShowPostFee: z.boolean(),
    autoAuditEnabled: z.boolean(),
    autoAuditTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time, e.g. 02:00"),
  })
  .partial()
  .strict()

export type PropertySettingsPatch = z.infer<typeof propertySettingsPatchSchema>

export async function updatePropertySettings(
  propertyId: string,
  patch: PropertySettingsPatch,
  db: Db = prisma
): Promise<PropertySettingsValues> {
  await db.propertySettings.upsert({
    where: { propertyId },
    create: { propertyId, ...patch },
    update: patch,
  })
  return getPropertySettings(propertyId, db)
}

// The id pointers in a settings patch must name records of THIS property — a charge code,
// payment method or outlet of another property (or enterprise) is refused. Returns an
// error message, or null when everything checks out.
export async function checkSettingsPointers(propertyId: string, patch: PropertySettingsPatch, db: Db = prisma): Promise<string | null> {
  const codeFields = ["defaultAccommodationChargeCodeId", "defaultGreenTaxChargeCodeId", "commissionChargeCodeId"] as const
  for (const f of codeFields) {
    const id = patch[f]
    if (!id) continue
    const code = await db.chargeCode.findUnique({ where: { id }, select: { propertyId: true } })
    if (!code || code.propertyId !== propertyId) return `${f}: that charge code isn't one of this property's`
  }
  if (patch.cityLedgerPaymentMethodId) {
    const pm = await db.paymentMethod.findUnique({ where: { id: patch.cityLedgerPaymentMethodId }, select: { propertyId: true, type: true } })
    if (!pm || pm.propertyId !== propertyId) return "cityLedgerPaymentMethodId: that payment method isn't one of this property's"
    if (pm.type !== "CITY_LEDGER") return "The City Ledger settlement method must be a CITY_LEDGER payment method"
  }
  for (const f of ["spaOutletId", "excursionOutletId"] as const) {
    const id = patch[f]
    if (!id) continue
    const outlet = await db.outlet.findUnique({ where: { id }, select: { propertyId: true } })
    if (!outlet || outlet.propertyId !== propertyId) return `${f}: that outlet isn't one of this property's`
  }
  return null
}
