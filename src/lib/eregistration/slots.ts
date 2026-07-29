// The reconciling slot-generation algorithm for eRegistration. Pure — takes plain data,
// returns a plan the caller executes as Prisma writes inside a transaction. Kept free of
// Prisma/DB access so it's directly unit-testable.
//
// ERegistrationGuestSlot is unique on (reservationId, slotIndex) — a reservation only
// ever has ONE slot at index 0, ONE at index 1, etc, regardless of which link currently
// "owns" them. So generating/regenerating a link is really reconciling that fixed set of
// slots to the reservation's current headcount, then re-pointing the kept slots at the
// new link — never a blanket delete-and-recreate, which would destroy a guest's already-
// submitted photo/signature/ID the moment staff changed the room count.

export type ExistingAccompanyingGuest = {
  profileId: string;
  createdAt: Date | string;
};

export type SlotReconciliationInput = {
  adults: number;
  primaryGuestId: string;
  // Must already be ordered by createdAt ascending by the caller — AccompanyingGuest has
  // no position column, so "stored order" only means insertion order, and Prisma/SQLite
  // do not guarantee that on read without an explicit orderBy.
  accompanyingGuests: ExistingAccompanyingGuest[];
};

export type ExistingSlotSummary = {
  slotIndex: number;
  existingProfileId: string | null;
  status: "PENDING" | "SUBMITTED" | "APPLIED";
};

export type SlotReconciliationPlan = {
  // New slot rows to create (PENDING).
  toCreate: { slotIndex: number; isPrimary: boolean; existingProfileId: string | null }[];
  // Existing PENDING rows whose target existingProfileId changed — safe to update because
  // nothing guest-visible has happened for them yet.
  toUpdate: { slotIndex: number; existingProfileId: string | null }[];
  // Every slot index that should end up pointing at the new link (created, updated, or
  // simply carried forward unchanged).
  toRelink: number[];
  // PENDING rows beyond the new target headcount — safe to delete, nothing submitted.
  toDeletePending: number[];
  // Human-readable warnings for the staff-facing generate response. Never blocks
  // generation; the owner can proceed regardless.
  warnings: string[];
};

export function planSlotReconciliation(
  reservation: SlotReconciliationInput,
  existingSlots: ExistingSlotSummary[]
): SlotReconciliationPlan {
  const accompanying = reservation.accompanyingGuests;
  const adultSlotCount = Math.max(reservation.adults, 1);

  const targetProfileByIndex = new Map<number, string | null>();
  targetProfileByIndex.set(0, reservation.primaryGuestId);
  for (let i = 1; i < adultSlotCount; i++) {
    const acc = accompanying[i - 1];
    targetProfileByIndex.set(i, acc ? acc.profileId : null);
  }
  const excessAccompanying = Math.max(0, accompanying.length - (adultSlotCount - 1));

  const existingByIndex = new Map(existingSlots.map((s) => [s.slotIndex, s]));

  const toCreate: SlotReconciliationPlan["toCreate"] = [];
  const toUpdate: SlotReconciliationPlan["toUpdate"] = [];
  const toRelink: number[] = [];
  const toDeletePending: number[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < adultSlotCount; i++) {
    const wantProfileId = targetProfileByIndex.get(i) ?? null;
    const existing = existingByIndex.get(i);
    if (!existing) {
      toCreate.push({ slotIndex: i, isPrimary: i === 0, existingProfileId: wantProfileId });
      continue;
    }
    toRelink.push(i);
    if (existing.status === "PENDING") {
      if (existing.existingProfileId !== wantProfileId) {
        toUpdate.push({ slotIndex: i, existingProfileId: wantProfileId });
      }
    } else if (existing.existingProfileId !== wantProfileId) {
      // Already submitted/applied for a different profile than the reservation now
      // lists at this position — never silently reassigned. Flag it; a human decides.
      warnings.push(
        `Guest slot ${i + 1} was already submitted, but the reservation's guest list at that position has since changed — review it manually rather than relying on auto-sync.`
      );
    }
  }

  // Slots beyond the new target headcount.
  for (const [idx, existing] of existingByIndex) {
    if (idx < adultSlotCount) continue;
    if (existing.status === "PENDING") {
      toDeletePending.push(idx);
    } else {
      // A submitted/applied compliance record outlives a headcount reduction — kept and
      // still relinked, just no longer offered as an "active" slot for new input.
      toRelink.push(idx);
    }
  }

  if (excessAccompanying > 0) {
    warnings.push(
      `This reservation lists ${accompanying.length} accompanying guest(s) but only ${adultSlotCount - 1} adult seat(s) beyond the primary guest — ${excessAccompanying} will not get an eRegistration slot. Fix the headcount or guest list first if that's not intended.`
    );
  }

  return { toCreate, toUpdate, toRelink, toDeletePending, warnings };
}

// --- Declared children (name + DOB only, no ID/signature) ---------------------------

export type ChildInfo = { name: string; dateOfBirth: string | null };

const MAX_CHILDREN = 20;
const MAX_NAME_LENGTH = 200;

// Bounded, defensively-parsed JSON-in-text — same storage convention as
// ChannelBooking.rawPayload (a plain String column, not a Prisma Json type, since no
// model in this schema uses one). Caps count and string length so a public-adjacent
// write path (slot 0's own guest, but still low-trust input) can't stuff an arbitrarily
// large payload into a text column.
export function serializeChildrenInfo(children: ChildInfo[]): string {
  const bounded = children.slice(0, MAX_CHILDREN).map((c) => ({
    name: (c.name ?? "").slice(0, MAX_NAME_LENGTH).trim(),
    dateOfBirth: c.dateOfBirth ?? null,
  }));
  return JSON.stringify(bounded);
}

export function parseChildrenInfo(raw: string | null): ChildInfo[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_CHILDREN)
      .filter((c): c is ChildInfo => c && typeof c.name === "string")
      .map((c) => ({ name: c.name.slice(0, MAX_NAME_LENGTH), dateOfBirth: c.dateOfBirth ?? null }));
  } catch {
    return [];
  }
}
