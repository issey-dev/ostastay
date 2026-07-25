// Therapist/room availability engine — see SPA_PLAN.md §7. Server-computed at
// slot-picker time AND re-validated identically at save time; the booking route never
// trusts a client-cached slot list. All comparisons here use "HH:MM" strings directly
// (lexicographic compare is correct for zero-padded 24h time-of-day) or the shared
// day-only Date normalization below — never a full combined timestamp, since
// appointments don't cross midnight in v1 (see SPA_PLAN.md §15).
//
// Every function here works in terms of the resource's actual BLOCKED window, not the
// guest-visible treatment window: `blockedFromTime` = startTime minus the
// treatment's preparation buffer, `blockedUntilTime` = treatmentEndTime plus the
// cleanup buffer (the field already stored on SpaAppointment). Both buffers block the
// resource even though neither is shown to the guest as treatment time — the
// preparation buffer blocking anything was a real gap in an earlier draft of this
// file (it only extended the end of the window, never the start) and is fixed here.

import { prisma } from "@/lib/db";
import { addMinutesToTime } from "@/lib/spa";

export const BLOCKING_STATUSES = ["CONFIRMED", "CHECKED_IN", "IN_TREATMENT"] as const;

export function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function timesOverlap(existingStart: string, existingEnd: string, requestedStart: string, requestedEnd: string): boolean {
  return existingStart < requestedEnd && existingEnd > requestedStart;
}

type BlockingAppointment = {
  id: string;
  roomId: string | null;
  blockedFromTime: string;
  blockedUntilTime: string;
  participants: { therapistId: string | null }[];
};

// Appointments that occupy a room/therapist for the requested date — CONFIRMED/
// CHECKED_IN/IN_TREATMENT always block; TENTATIVE only blocks within
// tentativeHoldMinutes of creation (a stale tentative hold stops blocking on its own,
// no expiry job needed — see SPA_PLAN.md §7). CANCELLED/COMPLETED/NO_SHOW never block.
// `excludeAppointmentId` lets a reschedule (Phase 5) check against every appointment
// except the one being moved. Each row's own blockedFromTime is derived from its
// stored startTime minus its own preparationBufferMinutesSnapshot — an existing
// appointment's prep buffer blocks other bookings just as much as its cleanup buffer.
async function getBlockingAppointments(
  propertyId: string,
  date: Date,
  tentativeHoldMinutes: number,
  excludeAppointmentId?: string
): Promise<BlockingAppointment[]> {
  const holdCutoff = new Date(Date.now() - tentativeHoldMinutes * 60 * 1000);
  const rows = await prisma.spaAppointment.findMany({
    where: {
      propertyId,
      appointmentDate: dayStart(date),
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
      OR: [
        { appointmentStatus: { in: [...BLOCKING_STATUSES] } },
        { appointmentStatus: "TENTATIVE", createdAt: { gte: holdCutoff } },
      ],
    },
    select: {
      id: true,
      roomId: true,
      startTime: true,
      blockedUntilTime: true,
      preparationBufferMinutesSnapshot: true,
      participants: { select: { therapistId: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    roomId: r.roomId,
    blockedFromTime: addMinutesToTime(r.startTime, -r.preparationBufferMinutesSnapshot),
    blockedUntilTime: r.blockedUntilTime,
    participants: r.participants,
  }));
}

// Candidate room ids for a treatment, with `preferred` — explicit SpaTreatmentRoom
// mappings win if any exist; otherwise (no compatibility configured at all) falls
// back to every bookable room at the property. `SpaRoom.roomType` is a coarse
// display/filter label on the room itself (schema comment: "free-text coarse
// filter") — SpaTreatment has no matching field to key a roomType fallback off, so
// there is no middle tier here; that's a simplification from the original plan
// text, not a schema change, since adding a treatment-side field mid-phase would be
// scope creep for the booking engine. Compatibility only — does NOT filter by
// capacity, exceptions, or current bookings; callers that need actually-available
// rooms use getAvailableRooms below. Exported so the booking route can gather the
// full lock-key candidate pool without mistakenly using getAvailableRooms (which
// would exclude rooms busy at OTHER times that day, undershooting the set of rooms
// that need locking).
export async function getCompatibleRoomIds(propertyId: string, treatmentId: string): Promise<Map<string, boolean>> {
  const treatment = await prisma.spaTreatment.findUnique({
    where: { id: treatmentId },
    include: { compatibleRooms: true },
  });
  if (!treatment) return new Map();

  if (treatment.compatibleRooms.length > 0) {
    return new Map(treatment.compatibleRooms.map((cr) => [cr.roomId, cr.preferred]));
  }

  const rooms = await prisma.spaRoom.findMany({
    where: { propertyId, isActive: true, bookable: true },
    select: { id: true },
  });
  return new Map(rooms.map((r) => [r.id, false]));
}

export type RoomCandidate = { id: string; name: string; preferred: boolean };

// `blockedFromTime`/`blockedUntilTime` here are the TRUE resource-hold window
// (already prep/cleanup-adjusted by the caller) — see the file header.
export async function getAvailableRooms(params: {
  propertyId: string;
  treatmentId: string;
  partySize: number;
  date: Date;
  blockedFromTime: string;
  blockedUntilTime: string;
  excludeAppointmentId?: string;
}): Promise<RoomCandidate[]> {
  const { propertyId, treatmentId, partySize, date, blockedFromTime, blockedUntilTime, excludeAppointmentId } = params;

  const candidateIds = await getCompatibleRoomIds(propertyId, treatmentId);
  if (candidateIds.size === 0) return [];

  const rooms = await prisma.spaRoom.findMany({
    where: { id: { in: Array.from(candidateIds.keys()) }, capacity: { gte: partySize }, isActive: true, bookable: true },
    select: { id: true, name: true },
  });
  if (rooms.length === 0) return [];

  const day = dayStart(date);
  const exceptions = await prisma.spaRoomAvailabilityException.findMany({
    where: { roomId: { in: rooms.map((r) => r.id) }, date: day },
  });
  const blockedRoomIds = new Set(
    exceptions
      .filter((e) => !e.startTime || timesOverlap(e.startTime, e.endTime ?? "23:59", blockedFromTime, blockedUntilTime))
      .map((e) => e.roomId)
  );

  const spaSettings = await prisma.spaSettings.findUnique({ where: { propertyId } });
  const tentativeHoldMinutes = spaSettings?.tentativeHoldMinutes ?? 20;
  const blocking = await getBlockingAppointments(propertyId, date, tentativeHoldMinutes, excludeAppointmentId);
  const roomOverlapped = new Set(
    blocking
      .filter((b) => b.roomId && timesOverlap(b.blockedFromTime, b.blockedUntilTime, blockedFromTime, blockedUntilTime))
      .map((b) => b.roomId as string)
  );

  return rooms
    .filter((r) => !blockedRoomIds.has(r.id) && !roomOverlapped.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, preferred: candidateIds.get(r.id) ?? false }))
    .sort((a, b) => (a.preferred === b.preferred ? a.id.localeCompare(b.id) : a.preferred ? -1 : 1));
}

export type TherapistCandidate = { id: string; displayName: string; gender: string | null; preferred: boolean; workload: number };

// One participant slot's therapist ask — at most one of these is meaningful at a time
// (a specific-name request makes a gender filter moot, enforced by the caller, not
// here). Both undefined/null means "any qualified therapist," today's original
// behavior.
export type TherapistRequirement = { requestedTherapistId?: string | null; requestedGender?: string | null };

// Candidate therapists for ONE participant slot of a treatment, on a given date/time —
// qualified, working, not on an exception, and not already occupied by another
// blocking appointment. `excludeTherapistIds` lets a multi-participant booking exclude
// therapists already picked for an earlier participant slot in the SAME booking
// attempt, so two participants on one new appointment can never land on the same
// therapist (SPA_PLAN.md §7). `requiredTherapistId`/`requiredGender` narrow the
// candidate pool to a guest's explicit request — see SPA_PLAN.md's therapist-request
// addendum; an unsatisfiable request (e.g. the named therapist is off that day) simply
// returns an empty list, same as any other infeasible slot.
export async function getAvailableTherapists(params: {
  propertyId: string;
  treatmentId: string;
  date: Date;
  blockedFromTime: string;
  blockedUntilTime: string;
  excludeTherapistIds?: string[];
  excludeAppointmentId?: string;
  requiredTherapistId?: string | null;
  requiredGender?: string | null;
}): Promise<TherapistCandidate[]> {
  const {
    propertyId, treatmentId, date, blockedFromTime, blockedUntilTime,
    excludeTherapistIds = [], excludeAppointmentId, requiredTherapistId, requiredGender,
  } = params;

  // The requested therapist is already claimed by an earlier participant in this same
  // booking attempt — infeasible, and NOT the same thing as "requiredTherapistId isn't
  // qualified" (that also returns [] below, via the query itself finding no rows).
  if (requiredTherapistId && excludeTherapistIds.includes(requiredTherapistId)) return [];

  const qualified = await prisma.spaTherapistTreatment.findMany({
    where: {
      treatmentId,
      qualified: true,
      therapist: {
        propertyId, isActive: true, bookable: true,
        id: requiredTherapistId ? requiredTherapistId : { notIn: excludeTherapistIds },
        ...(requiredGender ? { gender: requiredGender } : {}),
      },
    },
    select: { preferred: true, therapist: { select: { id: true, displayName: true, gender: true } } },
  });
  if (qualified.length === 0) return [];

  const therapistIds = qualified.map((q) => q.therapist.id);
  const day = dayStart(date);
  // Weekday from the UTC-normalized day (not the raw date's local getDay), so it matches
  // the UTC day boundary the schedules/exceptions are stored against (A13).
  const dayOfWeek = day.getUTCDay();

  const [exceptions, schedules] = await Promise.all([
    prisma.spaTherapistAvailabilityException.findMany({ where: { therapistId: { in: therapistIds }, date: day } }),
    prisma.spaTherapistSchedule.findMany({
      where: { therapistId: { in: therapistIds }, dayOfWeek, isActive: true, effectiveFrom: { lte: day } },
    }),
  ]);

  const blockedByException = new Set<string>();
  const extendedByException = new Set<string>();
  for (const e of exceptions) {
    const coversSlot = !e.startTime || timesOverlap(e.startTime, e.endTime ?? "23:59", blockedFromTime, blockedUntilTime);
    if (!coversSlot) continue;
    if (e.exceptionType === "EXTENDED_HOURS") {
      if (e.startTime && e.startTime <= blockedFromTime && (e.endTime ?? "23:59") >= blockedUntilTime) {
        extendedByException.add(e.therapistId);
      }
    } else {
      blockedByException.add(e.therapistId);
    }
  }

  const workingTherapistIds = new Set(
    schedules
      .filter((s) => (!s.effectiveTo || s.effectiveTo >= day) && s.startTime <= blockedFromTime && s.endTime >= blockedUntilTime)
      .map((s) => s.therapistId)
  );

  const spaSettings = await prisma.spaSettings.findUnique({ where: { propertyId } });
  const tentativeHoldMinutes = spaSettings?.tentativeHoldMinutes ?? 20;
  const blocking = await getBlockingAppointments(propertyId, date, tentativeHoldMinutes, excludeAppointmentId);
  const occupiedTherapistIds = new Set(
    blocking
      .filter((b) => timesOverlap(b.blockedFromTime, b.blockedUntilTime, blockedFromTime, blockedUntilTime))
      .flatMap((b) => b.participants.map((p) => p.therapistId).filter((id): id is string => !!id))
  );

  // Workload = how many participant slots this therapist already has today (any
  // status counted, blocking or not, as a simple fairness signal) — used to break
  // ties toward the least-booked therapist, not for correctness.
  const todaysCounts = await prisma.spaAppointmentParticipant.groupBy({
    by: ["therapistId"],
    where: { therapistId: { in: therapistIds }, appointment: { propertyId, appointmentDate: day } },
    _count: { therapistId: true },
  });
  const workloadByTherapist = new Map(todaysCounts.map((c) => [c.therapistId as string, c._count.therapistId]));

  return qualified
    .filter((q) => {
      const id = q.therapist.id;
      if (blockedByException.has(id)) return false;
      if (occupiedTherapistIds.has(id)) return false;
      return extendedByException.has(id) || workingTherapistIds.has(id);
    })
    .map((q) => ({
      id: q.therapist.id,
      displayName: q.therapist.displayName,
      gender: q.therapist.gender,
      preferred: q.preferred,
      workload: workloadByTherapist.get(q.therapist.id) ?? 0,
    }))
    .sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      if (a.workload !== b.workload) return a.workload - b.workload;
      return a.id.localeCompare(b.id);
    });
}

// Deterministic auto-assignment (SPA_PLAN.md §7): rooms prefer a SpaTreatmentRoom
// `preferred` match, then stable id order. Therapists are assigned one participant
// slot at a time, in order, each pick excluding every therapist already assigned
// earlier in this same call — getAvailableTherapists' own sort already ranks
// preferred-first / lowest-workload-first / id tie-break, so the first candidate
// remaining after exclusion is always the correct pick.
export async function autoAssignRoom(params: {
  propertyId: string;
  treatmentId: string;
  partySize: number;
  date: Date;
  blockedFromTime: string;
  blockedUntilTime: string;
}): Promise<string | null> {
  const candidates = await getAvailableRooms(params);
  return candidates[0]?.id ?? null;
}

// `requirements` is one entry per participant (its length IS the party size) — each
// slot is assigned against its OWN constraint, not a shared undifferentiated pool, so a
// couple's booking where one guest requests "Maria" and the other has no preference (or
// a gender filter) resolves correctly instead of the two constraints bleeding together.
// Omitting requirements (or passing an all-empty array of the right length) reproduces
// today's original "any qualified therapist" behavior exactly.
export async function autoAssignTherapists(params: {
  propertyId: string;
  treatmentId: string;
  date: Date;
  blockedFromTime: string;
  blockedUntilTime: string;
  requirements: TherapistRequirement[];
}): Promise<string[] | null> {
  const { requirements, ...rest } = params;
  const assigned: string[] = [];
  for (const req of requirements) {
    const candidates = await getAvailableTherapists({
      ...rest,
      excludeTherapistIds: assigned,
      requiredTherapistId: req.requestedTherapistId,
      requiredGender: req.requestedGender,
    });
    if (candidates.length === 0) return null;
    assigned.push(candidates[0].id);
  }
  return assigned;
}

// Whether a slot has at least one room candidate and enough distinct therapist
// candidates for the whole party — the cheap feasibility check the slot-picker grid
// uses (SPA_PLAN.md §7's availability calculation). Booking itself always re-derives
// (and locks) the actual assignment separately; this never allocates anything.
// `requirements` defaults to `partySize` unconstrained slots when omitted, so existing
// callers that only care about "is anyone free" don't need to change.
export async function isSlotFeasible(params: {
  propertyId: string;
  treatmentId: string;
  partySize: number;
  date: Date;
  blockedFromTime: string;
  blockedUntilTime: string;
  requirements?: TherapistRequirement[];
}): Promise<boolean> {
  const rooms = await getAvailableRooms(params);
  if (rooms.length === 0) return false;
  const requirements = params.requirements ?? Array.from({ length: params.partySize }, () => ({}));
  const therapists = await autoAssignTherapists({ ...params, requirements });
  return therapists !== null;
}
