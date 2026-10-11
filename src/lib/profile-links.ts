import { prisma } from "@/lib/db"

// A profile that anything points at can't be deleted - only deactivated. "Anything" is every
// record that refers to the profile as a person or account: bookings (as guest, as travel agent,
// as an accompanying guest), folios and group blocks it pays, registrations, eRegistration slots,
// negotiated-rate access and spa preferences. Its own contact details, addresses, documents,
// notes and attachments are not links - they go with it.
export const PROFILE_LINK_COUNTS = {
  reservations: true,
  travelAgentReservations: true,
  accompanyingReservations: true,
  foliosAsPayee: true,
  groupBlocksAsPayee: true,
  guestRegistrations: true,
  negotiatedRateAccess: true,
  spaTherapistPreferences: true,
  eRegistrationSlots: true,
} as const

const LABELS: Record<keyof typeof PROFILE_LINK_COUNTS, string> = {
  reservations: "reservations",
  travelAgentReservations: "reservations as travel agent",
  accompanyingReservations: "reservations as accompanying guest",
  foliosAsPayee: "folios",
  groupBlocksAsPayee: "group blocks",
  guestRegistrations: "registrations",
  negotiatedRateAccess: "negotiated rate plans",
  spaTherapistPreferences: "spa preferences",
  eRegistrationSlots: "eRegistrations",
}

export type LinkCounts = Partial<Record<keyof typeof PROFILE_LINK_COUNTS, number>>

export const sumLinks = (counts: LinkCounts | undefined | null) =>
  Object.values(counts ?? {}).reduce<number>((a, n) => a + (n ?? 0), 0)

export function describeLinks(counts: LinkCounts): string {
  return (Object.keys(LABELS) as (keyof typeof LABELS)[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${counts[k]} ${LABELS[k]}`)
    .join(", ")
}

export async function profileLinks(upid: string) {
  const row = await prisma.profile.findUnique({ where: { upid }, select: { _count: { select: PROFILE_LINK_COUNTS } } })
  const counts: LinkCounts = row?._count ?? {}
  return { counts, total: sumLinks(counts), description: describeLinks(counts) }
}
