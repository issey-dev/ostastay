import { prisma } from "@/lib/db"
import { getPropertySettings } from "@/lib/property-settings"

// Guards for the Sequence Manager (Hub › property › Sequences). A counter is the LAST
// number handed out — the next document gets currentValue + 1 — so setting a counter
// below the highest number already printed on a document would make the app issue that
// number (and every one after it) a second time. These helpers work out the highest
// number actually issued, from the documents themselves rather than from the counter,
// so a counter that was already wrong can't hide an issued number.

export type GuardedSequenceType = "REGISTRATION_NO" | "PROFORMA_FOLIO" | "TAX_INVOICE" | "RECEIPT_NO" | "CHECK_NO"

export const SEQUENCE_DOCUMENT_LABELS: Record<GuardedSequenceType | "GUEST_REG_NO", string> = {
  REGISTRATION_NO: "reservation (booking) number",
  PROFORMA_FOLIO: "proforma folio number",
  TAX_INVOICE: "tax invoice number",
  RECEIPT_NO: "receipt number",
  CHECK_NO: "check number",
  GUEST_REG_NO: "guest registration number",
}

export class SequenceGuardError extends Error {
  status = 409
}

type MaxRow = { max: bigint | number | null }
const toNumber = (rows: MaxRow[]) => Number(rows[0]?.max ?? 0)

// Highest number embedded in the documents already issued at this property for the
// given sequence, or 0 when none has been issued. Numbers are stored formatted
// (INV-00012, PRO-00003, RCT-00007, "{prefix}000123"); only values in the app's own
// format count — a hand-typed or pre-sequence value can't be tied to the counter.
export async function highestIssuedNumber(propertyId: string, sequenceType: GuardedSequenceType): Promise<number> {
  switch (sequenceType) {
    case "TAX_INVOICE":
      return toNumber(await prisma.$queryRaw<MaxRow[]>`
        SELECT MAX(CAST(SUBSTRING("taxInvoiceNumber" FROM 5) AS BIGINT)) AS max
        FROM "Folio" WHERE "propertyId" = ${propertyId} AND "taxInvoiceNumber" ~ '^INV-[0-9]{1,15}$'`)
    case "PROFORMA_FOLIO":
      return toNumber(await prisma.$queryRaw<MaxRow[]>`
        SELECT MAX(CAST(SUBSTRING("proformaInvoiceNumber" FROM 5) AS BIGINT)) AS max
        FROM "Folio" WHERE "propertyId" = ${propertyId} AND "proformaInvoiceNumber" ~ '^PRO-[0-9]{1,15}$'`)
    case "RECEIPT_NO": {
      // Payment receipts and currency-exchange receipts share the one RECEIPT_NO counter.
      const payments = toNumber(await prisma.$queryRaw<MaxRow[]>`
        SELECT MAX(CAST(SUBSTRING(p."receiptNumber" FROM 5) AS BIGINT)) AS max
        FROM "Payment" p JOIN "Folio" f ON f."id" = p."folioId"
        WHERE f."propertyId" = ${propertyId} AND p."receiptNumber" ~ '^RCT-[0-9]{1,15}$'`)
      const exchanges = toNumber(await prisma.$queryRaw<MaxRow[]>`
        SELECT MAX(CAST(SUBSTRING("receiptNumber" FROM 5) AS BIGINT)) AS max
        FROM "CurrencyExchange" WHERE "propertyId" = ${propertyId} AND "receiptNumber" ~ '^RCT-[0-9]{1,15}$'`)
      return Math.max(payments, exchanges)
    }
    case "CHECK_NO":
      // Folio check numbers are plain digits when the app issues them; a number staff
      // edited to something else ("A-12") can't collide with the counter.
      return toNumber(await prisma.$queryRaw<MaxRow[]>`
        SELECT MAX(CAST(l."checkNo" AS BIGINT)) AS max
        FROM "FolioLineItem" l JOIN "Folio" f ON f."id" = l."folioId"
        WHERE f."propertyId" = ${propertyId} AND l."checkNo" ~ '^[0-9]{1,15}$'`)
    case "REGISTRATION_NO": {
      // Booking numbers are "{prefix}{zero-padded counter}", with the property's code
      // + "-" when no prefix is set (create-reservation.ts). Only the CURRENT prefix is
      // checked: numbers under an older prefix can't collide with new ones anyway.
      const [settings, property] = await Promise.all([
        getPropertySettings(propertyId),
        prisma.property.findUnique({ where: { id: propertyId }, select: { code: true } }),
      ])
      const prefix = settings.resConfirmPrefix || `${property?.code ?? "RES"}-`
      const from = prefix.length + 1
      return toNumber(await prisma.$queryRaw<MaxRow[]>`
        SELECT MAX(CAST(SUBSTRING("confirmationNo" FROM ${from}::int) AS BIGINT)) AS max
        FROM "Reservation"
        WHERE "propertyId" = ${propertyId}
          AND LEFT("confirmationNo", ${prefix.length}::int) = ${prefix}
          AND SUBSTRING("confirmationNo" FROM ${from}::int) ~ '^[0-9]{1,15}$'`)
    }
  }
}

// Green Tax registration numbers already given for this property in the current year —
// the calendar year and the property's business-date year (they differ around 1 Jan).
export async function greenTaxNumbersThisYear(propertyId: string): Promise<number> {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { businessDate: true } })
  const years = new Set([new Date().getUTCFullYear()])
  if (property?.businessDate) years.add(property.businessDate.getUTCFullYear())
  return prisma.guestRegistration.count({ where: { propertyId, year: { in: [...years] } } })
}

// Throws a SequenceGuardError (409, user-facing message) when `newValue` would make the
// app re-issue a number that is already on a document.
export async function assertSequenceChangeAllowed(
  propertyId: string,
  sequenceType: GuardedSequenceType | "GUEST_REG_NO",
  newValue: number
): Promise<void> {
  if (sequenceType === "GUEST_REG_NO") {
    const given = await greenTaxNumbersThisYear(propertyId)
    if (given > 0) {
      throw new SequenceGuardError(
        `Guest registration numbers have already been given this year (${given}), so this counter can't be set here. ` +
          "Use the corrections on the Green Tax register (Hub › Green Tax) to fix a number instead."
      )
    }
    return
  }
  const highest = await highestIssuedNumber(propertyId, sequenceType)
  if (newValue < highest) {
    throw new SequenceGuardError(
      `The highest ${SEQUENCE_DOCUMENT_LABELS[sequenceType]} already issued is ${highest}. ` +
        `Set the counter to ${highest} or higher so no number is issued twice.`
    )
  }
}
