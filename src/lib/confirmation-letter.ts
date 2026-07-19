// Pure formatting helpers shared between the Confirmation Letter print page (client
// JSX) and the confirmation email (server-rendered HTML string) — no server-only
// imports here, so both sides stay in sync on content without duplicating the logic.

type GuestName = { firstName: string; lastName: string | null }

export function formatGuestName(guest: GuestName): string {
  return [guest.firstName, guest.lastName].filter(Boolean).join(" ")
}

// Primary guest first, then every accompanying guest — this is the definitive "who is
// this reservation for" list the letter and email both need.
export function formatAllGuestNames(reservation: {
  primaryGuest: GuestName
  accompanyingGuests?: Array<{ profile: GuestName }>
}): string[] {
  return [
    formatGuestName(reservation.primaryGuest),
    ...(reservation.accompanyingGuests ?? []).map((ag) => formatGuestName(ag.profile)),
  ]
}

export function nightsCount(checkInDate: Date | string, checkOutDate: Date | string): number {
  const inDate = new Date(checkInDate)
  const outDate = new Date(checkOutDate)
  return Math.max(1, Math.round((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60 * 24)))
}

// Room categories actually booked — de-duplicated, in case a multi-segment (split)
// stay reuses the same room type across segments.
export function formatRoomCategories(assignments: Array<{ roomType: { name: string } }>): string[] {
  return Array.from(new Set(assignments.map((a) => a.roomType.name)))
}
