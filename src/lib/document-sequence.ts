import { prisma } from "@/lib/db"

// Mirrors the SEQUENCE_TYPES tuple in src/app/api/settings/sequences/route.ts — kept
// as a separate literal here rather than imported, since that file is a route module
// and this is a shared lib used by other route modules.
export type SequenceType = "REGISTRATION_NO" | "PROFORMA_FOLIO" | "TAX_INVOICE" | "RECEIPT_NO"

// Atomically allocates the next number in a property's named sequence (Sequence
// Manager, Controls > Reservations) and returns it. Call this exactly once per
// document — the caller is responsible for persisting the returned number onto its
// own record (Folio.taxInvoiceNumber, Payment.receiptNumber, ...) and checking that
// field first so a reprint reuses the stored number instead of calling this again.
export async function allocateSequenceNumber(propertyId: string, sequenceType: SequenceType): Promise<number> {
  const sequence = await prisma.propertySequence.upsert({
    where: { propertyId_sequenceType: { propertyId, sequenceType } },
    create: { propertyId, sequenceType, currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  })
  return sequence.currentValue
}
