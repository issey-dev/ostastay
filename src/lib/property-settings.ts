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
