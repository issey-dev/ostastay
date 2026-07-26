import { prisma } from "@/lib/db";
import { toUtcMidnight } from "@/lib/business-date";

// Assign the per-guest Green Tax Registration Number to every guest who arrived on a
// business date. Runs as an EOD step. Numbered in arrival order (check-in time),
// primary guest then accompanying guests. Rooms of a pseudo room type (which covers
// day-use) are excluded. The GUEST_REG_NO sequence resets on the first assignment of
// a new calendar year (every 1st January). Idempotent — a guest already registered
// for their stay is skipped, so a re-run never double-numbers.
export async function assignRegistrationNumbers(
  propertyId: string,
  businessDate: Date
): Promise<{ assigned: number; year: number }> {
  const bizDate = toUtcMidnight(businessDate);
  const nextDay = new Date(bizDate.getTime() + 86_400_000);
  const year = bizDate.getUTCFullYear();

  // Arrivals for this business date: checked-in reservations scheduled to arrive today,
  // assigned to at least one non-pseudo (real) room. Ordered by actual check-in time.
  const arrivals = await prisma.reservation.findMany({
    where: {
      propertyId,
      status: "IN_HOUSE",
      checkInDate: { gte: bizDate, lt: nextDay },
      assignments: { some: { roomType: { isPseudo: false } } },
    },
    include: {
      accompanyingGuests: { orderBy: { createdAt: "asc" } },
      guestRegistrations: true,
    },
    orderBy: [{ checkedInAt: "asc" }, { createdAt: "asc" }],
  });

  let assigned = 0;
  await prisma.$transaction(async (tx) => {
    const seq = await tx.propertySequence.findUnique({
      where: { propertyId_sequenceType: { propertyId, sequenceType: "GUEST_REG_NO" } },
    });
    // Reset the counter on the first assignment of a new year.
    const seqStart = seq && seq.resetYear === year ? seq.currentValue : 0;
    // Never trust the sequence blindly: if registrations already exist for this year
    // (e.g. from imported/seeded data that didn't advance the sequence), start above
    // their maximum so we can't collide on @@unique([propertyId, year, registrationNo]).
    const existingMax = await tx.guestRegistration.aggregate({
      where: { propertyId, year },
      _max: { registrationNo: true },
    });
    let current = Math.max(seqStart, existingMax._max.registrationNo ?? 0);

    for (const res of arrivals) {
      // Primary guest first, then accompanying guests — deduped (a profile can't take
      // two numbers on one stay), skipping anyone already registered.
      const seen = new Set<string>();
      const guests: { profileId: string; isPrimary: boolean }[] = [];
      const push = (profileId: string, isPrimary: boolean) => {
        if (seen.has(profileId)) return;
        seen.add(profileId);
        guests.push({ profileId, isPrimary });
      };
      push(res.primaryGuestId, true);
      for (const a of res.accompanyingGuests) push(a.profileId, false);

      for (const g of guests) {
        if (res.guestRegistrations.some((r) => r.profileId === g.profileId)) continue;
        current += 1;
        await tx.guestRegistration.create({
          data: {
            propertyId,
            reservationId: res.id,
            profileId: g.profileId,
            registrationNo: current,
            year,
            isPrimary: g.isPrimary,
            businessDate: bizDate,
          },
        });
        assigned += 1;
      }
    }

    await tx.propertySequence.upsert({
      where: { propertyId_sequenceType: { propertyId, sequenceType: "GUEST_REG_NO" } },
      update: { currentValue: current, resetYear: year },
      create: { propertyId, sequenceType: "GUEST_REG_NO", currentValue: current, resetYear: year },
    });
  });

  return { assigned, year };
}
