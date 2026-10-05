import { prisma } from "@/lib/db"
import { resolveOutletChargeTax } from "@/lib/tax-calc"
import type { PostingTaxSettings } from "@/lib/posting/post-charge"
import { POSTABLE_BOOKING_STATUSES } from "@/lib/transport/constants"
import { taxOverrideFor } from "@/lib/transport/pricing"
import { transferDescription } from "@/lib/transport/billing"

// A reservation's Transportation bookings as the guest's EXPECTED charges — for the
// proforma invoice and the reservation's daily breakdown, which project the whole stay
// rather than read posted lines. Same amount, charge code and tax the posting will use.
// Waived, voided and complimentary transfers are left out; so are drafts, no-shows and
// cancellations (Night Audit never posts those).

export type ProjectedTransfer = {
  id: string
  description: string
  chargeCode: string
  date: Date
  baseAmount: number
  taxAmount: number
  serviceChargeAmount: number
  breakdown: { name: string; amount: number }[]
}

export async function projectedTransfers(
  reservationId: string,
  propertyId: string,
  settings: PostingTaxSettings | null,
  pricesIncludeTaxes: boolean
): Promise<ProjectedTransfer[]> {
  const bookings = await prisma.transportBooking.findMany({
    where: {
      reservationId,
      propertyId,
      status: { in: POSTABLE_BOOKING_STATUSES },
      billingStatus: { in: ["NOT_BILLED", "PENDING", "POSTED"] },
      amount: { gt: 0 },
      chargeCodeId: { not: null },
    },
    include: { route: { select: { name: true } } },
    orderBy: { serviceDate: "asc" },
  })
  if (bookings.length === 0) return []
  const codes = await prisma.chargeCode.findMany({
    where: { id: { in: [...new Set(bookings.map((b) => b.chargeCodeId!))] }, propertyId },
    include: { taxProfile: { include: { rates: true } } },
  })
  const profiles = await prisma.taxProfile.findMany({
    where: { id: { in: bookings.map((b) => b.taxProfileId).filter((x): x is string => !!x) }, propertyId },
    include: { rates: true },
  })
  const codeMap = new Map(codes.map((c) => [c.id, c]))
  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const out: ProjectedTransfer[] = []
  for (const b of bookings) {
    const code = codeMap.get(b.chargeCodeId!)
    if (!code) continue
    const t = resolveOutletChargeTax({
      chargeCode: code,
      outlet: taxOverrideFor(b.taxMode, b.taxProfileId ? profileMap.get(b.taxProfileId) ?? null : null),
      inputAmount: b.amount!,
      settings,
      pricesIncludeTaxes,
    })
    out.push({
      id: b.id,
      description: transferDescription(b),
      chargeCode: code.code,
      date: b.serviceDate,
      baseAmount: t.baseAmount,
      taxAmount: t.taxAmount,
      serviceChargeAmount: t.serviceChargeAmount,
      breakdown: t.breakdown,
    })
  }
  return out
}
