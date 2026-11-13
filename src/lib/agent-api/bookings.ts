import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { systemContext } from "@/lib/reservations/system-context";
import { pickupIntoBlock } from "@/lib/groups/pickup";
import { createSlotRequest, withdrawSlotRequest } from "@/lib/groups/slot-requests";
import { resolveGuestProfile } from "@/lib/profiles/resolve-guest-profile";
import { getPropertySettings } from "@/lib/property-settings";
import { toUtcMidnight } from "@/lib/business-date";
import { agentQuote, agentRatePlans } from "@/lib/agent-api/catalogue";
import { AgentApiError, notFound } from "@/lib/agent-api/http";
import { emitAgentEvent } from "@/lib/agent-api/events";
import { notifyAgentActivity } from "@/lib/notifications/producers";
import type { AgentIdentity } from "@/lib/agent-api/auth";
import type { AuthContext } from "@/lib/scope";

// The Agent API write side (Agent Portal plan §1a steps 2-6, A-7, A-13…A-17; Phase 6, 9.6.0).
//
//   · An agent requests a slot (a REQUESTED group block: holds nothing). The hotel decides.
//   · Every booking is a pickup in one of the agent's own approved slots, through the same
//     service the desk uses (src/lib/groups/pickup.ts): availability, elasticity, lock, all
//     identical. Agents never overbook and never sell into the sell limit.
//   · A booking starts TENTATIVE (option = the slot's cutoff), unless the hotel switched on
//     "bookings confirm automatically" for this Source. The hotel confirms it at the desk.
//   · The agent can never delete a booking, never cancel a confirmed one (only ask), and can
//     cancel a tentative one with a reason. In house and after: read-only.
//   · Anything that is not the agent's own answers 404.

const DAY = 86_400_000;
const newAgentRef = () => `AG-${randomBytes(6).toString("base64url").toUpperCase().replace(/[-_]/g, "X")}`;

/** The context the shared services run with for an agent: no staff permissions at all. */
function agentContext(agent: AgentIdentity): AuthContext {
  const ctx = systemContext(agent.enterpriseId, `agent:${agent.agentUserId}`);
  return { ...ctx, capabilities: new Set() };
}

// ── Slots ────────────────────────────────────────────────────────────────────────────

function slotDto(b: {
  code: string; status: string; startDate: Date; endDate: Date; cutoffDate: Date | null; releaseDays: number | null;
  elasticRooms: number; elasticNightsBefore: number; elasticNightsAfter: number; requestNote: string | null; decisionReason: string | null;
  isOverflowRequest: boolean; propertyId: string;
  roomHolds: { roomTypeId: string; quantity: number; requestedQuantity: number | null; roomType: { code: string; name: string } }[];
  reservations?: { status: string; assignments: { roomTypeId: string }[] }[];
  checkpoints?: { date: Date; minPercent: number; processedAt: Date | null; releasedRooms: number | null }[];
}) {
  const live = (b.reservations ?? []).filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  const requested = b.status === "REQUESTED";
  return {
    code: b.code,
    propertyId: b.propertyId,
    status: b.status === "REQUESTED" ? "AWAITING_HOTEL" : b.status === "DECLINED" ? "DECLINED" : b.status,
    from: b.startDate.toISOString().slice(0, 10),
    to: b.endDate.toISOString().slice(0, 10),
    overflow: b.isOverflowRequest,
    note: b.requestNote,
    hotelNote: b.decisionReason,
    rooms: b.roomHolds.map((h) => {
      const booked = live.filter((r) => r.assignments.some((a) => a.roomTypeId === h.roomTypeId));
      return {
        roomTypeId: h.roomTypeId,
        roomType: h.roomType.name,
        askedFor: h.requestedQuantity ?? h.quantity,
        approved: requested ? null : h.quantity,
        bookedTentative: booked.filter((r) => r.status === "TENTATIVE").length,
        bookedConfirmed: booked.filter((r) => r.status !== "TENTATIVE").length,
      };
    }),
    cutoffDate: b.cutoffDate ? b.cutoffDate.toISOString().slice(0, 10) : null,
    releaseDays: b.releaseDays,
    flexibility: { extraRooms: b.elasticRooms, nightsBefore: b.elasticNightsBefore, nightsAfter: b.elasticNightsAfter },
    checkpoints: (b.checkpoints ?? []).map((c) => ({
      date: c.date.toISOString().slice(0, 10),
      minPercent: c.minPercent,
      result: c.processedAt ? (c.releasedRooms ? "MISSED" : "MET") : "PENDING",
      releasedRooms: c.releasedRooms ?? 0,
    })),
  };
}

const SLOT_INCLUDE = {
  roomHolds: { include: { roomType: { select: { code: true, name: true } } } },
  reservations: { select: { status: true, assignments: { select: { roomTypeId: true } } } },
  checkpoints: { orderBy: { date: "asc" as const } },
};

export async function requestSlot(agent: AgentIdentity, propertyId: string, body: Record<string, unknown>) {
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AgentApiError(400, "INVALID_DATES", "Send from and to as yyyy-MM-dd.");
  const isOverflow = body.overflow === true;
  if (isOverflow) {
    const { maxOverflowPerNight } = await getPropertySettings(propertyId);
    if (maxOverflowPerNight === 0) throw new AgentApiError(409, "OVERFLOW_NOT_ALLOWED", "This hotel does not take overflow requests.");
  }
  const block = await createSlotRequest({
    enterpriseId: agent.enterpriseId,
    propertyId,
    sourceProfileId: agent.sourceProfileId,
    startDate: new Date(`${from}T00:00:00Z`),
    endDate: new Date(`${to}T00:00:00Z`),
    rooms: body.rooms,
    note: typeof body.note === "string" ? body.note : null,
    isOverflow,
    origin: "AGENT_PORTAL",
    requestedByAgentUserId: agent.agentUserId,
  });
  await notifyAgentActivity({
    enterpriseId: agent.enterpriseId,
    propertyId,
    kind: "SLOT_REQUESTED",
    entityId: block.id,
    title: `${isOverflow ? "Overflow request" : "Slot request"} from ${agent.sourceName}`,
    url: (slug) => `/e/${slug}/dashboard/groups?tab=requests`,
  });
  const full = await prisma.groupBlock.findUniqueOrThrow({ where: { id: block.id }, include: SLOT_INCLUDE });
  return slotDto(full);
}

export async function listSlots(agent: AgentIdentity, propertyIds: string[], q: { status?: string | null }) {
  const statusMap: Record<string, string[]> = { AWAITING_HOTEL: ["REQUESTED"], TENTATIVE: ["TENTATIVE"], DEFINITE: ["DEFINITE"], DECLINED: ["DECLINED"] };
  const rows = await prisma.groupBlock.findMany({
    where: {
      sourceProfileId: agent.sourceProfileId,
      propertyId: { in: propertyIds },
      ...(q.status && statusMap[q.status] ? { status: { in: statusMap[q.status] } } : {}),
    },
    include: SLOT_INCLUDE,
    orderBy: { startDate: "asc" },
    take: 200,
  });
  return rows.map(slotDto);
}

async function ownSlot(agent: AgentIdentity, propertyIds: string[], code: string) {
  const b = await prisma.groupBlock.findFirst({
    where: { code, sourceProfileId: agent.sourceProfileId, propertyId: { in: propertyIds } },
    include: SLOT_INCLUDE,
  });
  if (!b) throw notFound("Slot not found.");
  return b;
}

export async function getSlot(agent: AgentIdentity, propertyIds: string[], code: string) {
  return slotDto(await ownSlot(agent, propertyIds, code));
}

export async function withdrawSlot(agent: AgentIdentity, propertyIds: string[], code: string) {
  const b = await ownSlot(agent, propertyIds, code);
  await withdrawSlotRequest(b.id, agent.sourceProfileId);
  return getSlot(agent, propertyIds, code);
}

// ── Bookings ─────────────────────────────────────────────────────────────────────────

type RoomIn = {
  roomTypeId?: unknown; checkIn?: unknown; checkOut?: unknown; adults?: unknown; children?: unknown;
  leadGuest?: { firstName?: unknown; lastName?: unknown; email?: unknown; phone?: unknown };
  agentReference?: unknown; packageName?: unknown; requests?: unknown; mealPlan?: unknown;
};

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * One or more rooms in a slot, all or nothing: every room is checked (and priced) before any
 * is written; if a write still fails (the last room went), the ones already made are
 * cancelled with the reason "Not completed" so nothing half-done is left holding rooms.
 */
export async function createBookingsInSlot(agent: AgentIdentity, propertyIds: string[], code: string, body: Record<string, unknown>) {
  const slot = await ownSlot(agent, propertyIds, code);
  if (slot.status === "REQUESTED") throw new AgentApiError(409, "SLOT_NOT_APPROVED", "The hotel has not approved this slot yet.");
  if (slot.status !== "TENTATIVE" && slot.status !== "DEFINITE") throw new AgentApiError(409, "SLOT_CLOSED", "This slot is closed.");
  const rooms = Array.isArray(body.rooms) ? (body.rooms as RoomIn[]) : [];
  if (rooms.length === 0 || rooms.length > 30) throw new AgentApiError(400, "INVALID_BODY", "Send 1 to 30 rooms.");
  const source = await prisma.profile.findUniqueOrThrow({ where: { upid: agent.sourceProfileId }, select: { portalAutoConfirm: true } });
  const plans = await agentRatePlans(agent.sourceProfileId, slot.propertyId);
  if (plans.length === 0 && !slot.isOverflowRequest) throw new AgentApiError(409, "NO_RATE", "No rate is set up for you at this property yet. Ask the hotel.");

  const today = toUtcMidnight(new Date());
  // Validate and price every room first.
  let total = 0;
  for (const [i, r] of rooms.entries()) {
    const first = str(r.leadGuest?.firstName, 80);
    const last = str(r.leadGuest?.lastName, 80);
    if (!first || !last) throw new AgentApiError(400, "INVALID_BODY", `Room ${i + 1}: the lead guest's first and last name are needed.`);
    const ci = new Date(String(r.checkIn ?? ""));
    if (isNaN(ci.getTime()) || toUtcMidnight(ci) < today) throw new AgentApiError(400, "INVALID_DATES", `Room ${i + 1}: arrival cannot be in the past.`);
    if (!slot.isOverflowRequest) {
      const q = await agentQuote(agent, slot.propertyId, { roomTypeId: r.roomTypeId, checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children, mealPlan: r.mealPlan });
      total += q.totals.grandTotal;
    }
  }
  if (typeof body.expectedTotal === "number" && Math.abs(body.expectedTotal - total) > 0.005) {
    throw new AgentApiError(409, "PRICE_CHANGED", "The price has changed since your quote.", { total: Math.round(total * 100) / 100 });
  }

  const ctx = agentContext(agent);
  const made: string[] = [];
  try {
    for (const [i, r] of rooms.entries()) {
      const roomTypeId = slot.isOverflowRequest ? slot.roomHolds[0]?.roomTypeId : String(r.roomTypeId ?? "");
      const result = await pickupIntoBlock(ctx, slot.id, {
        firstName: str(r.leadGuest?.firstName, 80)!,
        lastName: str(r.leadGuest?.lastName, 80)!,
        email: str(r.leadGuest?.email, 200)?.toLowerCase() ?? null,
        phone: str(r.leadGuest?.phone, 40),
        roomTypeId: roomTypeId ?? "",
        checkInDate: String(r.checkIn),
        checkOutDate: String(r.checkOut),
        adults: Number(r.adults ?? 1) || 1,
        children: Number(r.children ?? 0) || 0,
        ratePlanId: plans[0]?.id ?? null,
        mealPlanCode: str(r.mealPlan, 20),
        status: source.portalAutoConfirm ? "RESERVED" : "TENTATIVE",
        remarks: str(r.requests, 1000),
        origin: "AGENT_PORTAL",
        agentUserId: agent.agentUserId,
        packageName: str(r.packageName, 120),
        agentReference: str(r.agentReference, 80),
      });
      if (!result.ok) {
        throw new AgentApiError(result.status === 403 ? 409 : result.status, result.code ?? "REFUSED", `Room ${i + 1}: ${result.error}`);
      }
      await prisma.reservation.update({ where: { id: result.reservation.id }, data: { agentRef: newAgentRef(), ...(source.portalAutoConfirm ? { confirmedAt: new Date() } : {}) } });
      made.push(result.reservation.id);
    }
  } catch (e) {
    if (made.length) {
      await prisma.reservation.updateMany({
        where: { id: { in: made } },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReasonCode: "AGENT_INCOMPLETE", cancellationReason: "Not completed: another room in the same request failed" },
      });
    }
    throw e;
  }
  const rows = await prisma.reservation.findMany({ where: { id: { in: made } }, include: BOOKING_INCLUDE });
  for (const r of rows) await emitAgentEvent(agent.sourceProfileId, agent.enterpriseId, "booking.accepted", bookingDto(r));
  return rows.map(bookingDto);
}

export const BOOKING_INCLUDE = {
  primaryGuest: { select: { firstName: true, lastName: true } },
  accompanyingGuests: { include: { profile: { select: { upid: true, firstName: true, lastName: true, nationality: true, dateOfBirth: true } } } },
  assignments: { select: { roomTypeId: true, startDate: true, endDate: true, roomType: { select: { code: true, name: true } } } },
  transports: { select: { direction: true, carrierCode: true, carrierTime: true, transportType: true, remarks: true } },
  groupBlock: { select: { code: true } },
  property: { select: { id: true, name: true } },
  agentChangeRequests: { select: { id: true, type: true, status: true, note: true, decisionNote: true, createdAt: true }, orderBy: { createdAt: "desc" as const } },
};

type BookingRow = Awaited<ReturnType<typeof prisma.reservation.findFirstOrThrow<{ where: { id: string }; include: typeof BOOKING_INCLUDE }>>>;

export function agentStatus(r: { status: string; confirmationRequestedAt: Date | null; cancellationReasonCode: string | null; isOverflow: boolean }) {
  switch (r.status) {
    case "TENTATIVE":
      return r.confirmationRequestedAt ? "CONFIRMATION_REQUESTED" : "ON_OPTION";
    case "RESERVED":
      return "CONFIRMED";
    case "IN_HOUSE":
      return "IN_HOUSE";
    case "CHECKED_OUT":
      return "COMPLETED";
    case "NO_SHOW":
      return "NO_SHOW";
    default:
      return r.cancellationReasonCode === "OPTION_EXPIRED" ? "RELEASED" : "CANCELLED";
  }
}

/** What an agent may see of a booking: no room numbers, staff names, internal notes or money detail. */
export function bookingDto(r: BookingRow) {
  const a = r.assignments[0];
  const guests = r.accompanyingGuests.map((g) => ({
    id: g.profile.upid,
    firstName: g.profile.firstName,
    lastName: g.profile.lastName,
    nationality: g.profile.nationality,
    dateOfBirth: g.profile.dateOfBirth ? g.profile.dateOfBirth.toISOString().slice(0, 10) : null,
  }));
  const needed = r.adults + r.children - 1;
  return {
    ref: r.agentRef,
    confirmationNo: r.confirmationNo,
    slot: r.groupBlock?.code ?? null,
    property: r.property,
    status: agentStatus(r),
    optionUntil: r.status === "TENTATIVE" && r.optionDate ? r.optionDate.toISOString() : null,
    checkIn: r.checkInDate.toISOString().slice(0, 10),
    checkOut: r.checkOutDate.toISOString().slice(0, 10),
    roomType: a ? { id: a.roomTypeId, code: a.roomType.code, name: a.roomType.name } : null,
    adults: r.adults,
    children: r.children,
    leadGuest: { firstName: r.primaryGuest.firstName, lastName: r.primaryGuest.lastName },
    guests,
    guestDetailsComplete: guests.length >= needed && guests.every((g) => g.nationality && g.dateOfBirth),
    travel: r.transports.map((t) => ({ direction: t.direction === "DROPOFF" ? "DEPARTURE" : "ARRIVAL", flight: t.carrierCode, time: t.carrierTime?.toISOString() ?? null, transfer: t.transportType, notes: t.remarks })),
    packageName: r.packageName,
    agentReference: r.agentReference,
    requests: r.remarks,
    overflow: r.isOverflow ? { hotel: r.overflowHotelName } : null,
    confirmationVersion: r.agentConfirmationVersion,
    changeRequests: r.agentChangeRequests.map((c) => ({ id: c.id, type: c.type, status: c.status, note: c.note, hotelNote: c.decisionNote, createdAt: c.createdAt.toISOString() })),
  };
}

async function ownBooking(agent: AgentIdentity, propertyIds: string[], ref: string) {
  const r = await prisma.reservation.findFirst({
    where: { agentRef: ref, sourceProfileId: agent.sourceProfileId, propertyId: { in: propertyIds } },
    include: BOOKING_INCLUDE,
  });
  if (!r) throw notFound("Booking not found.");
  return r;
}

export async function listBookings(agent: AgentIdentity, propertyIds: string[], q: { status?: string | null; from?: string | null; to?: string | null; q?: string | null; page?: number }) {
  const statusMap: Record<string, object> = {
    ON_OPTION: { status: "TENTATIVE", confirmationRequestedAt: null },
    CONFIRMATION_REQUESTED: { status: "TENTATIVE", confirmationRequestedAt: { not: null } },
    CONFIRMED: { status: "RESERVED" },
    IN_HOUSE: { status: "IN_HOUSE" },
    COMPLETED: { status: "CHECKED_OUT" },
    CANCELLED: { status: { in: ["CANCELLED", "NO_SHOW"] } },
  };
  const page = Math.max(1, q.page ?? 1);
  const rows = await prisma.reservation.findMany({
    where: {
      sourceProfileId: agent.sourceProfileId,
      propertyId: { in: propertyIds },
      agentRef: { not: null },
      ...(q.status && statusMap[q.status] ? statusMap[q.status] : {}),
      ...(q.from ? { checkOutDate: { gt: new Date(`${q.from}T00:00:00Z`) } } : {}),
      ...(q.to ? { checkInDate: { lt: new Date(`${q.to}T00:00:00Z`) } } : {}),
      ...(q.q
        ? {
            OR: [
              { agentRef: { contains: q.q, mode: "insensitive" as const } },
              { agentReference: { contains: q.q, mode: "insensitive" as const } },
              { primaryGuest: { lastName: { contains: q.q, mode: "insensitive" as const } } },
              { primaryGuest: { firstName: { contains: q.q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: BOOKING_INCLUDE,
    orderBy: { checkInDate: "asc" },
    skip: (page - 1) * 50,
    take: 50,
  });
  return { page, bookings: rows.map(bookingDto) };
}

export async function getBooking(agent: AgentIdentity, propertyIds: string[], ref: string) {
  return bookingDto(await ownBooking(agent, propertyIds, ref));
}

/** "Request confirmation": the booking shows at the desk as confirmation requested. */
export async function requestConfirmation(agent: AgentIdentity, propertyIds: string[], ref: string, body: Record<string, unknown>) {
  const r = await ownBooking(agent, propertyIds, ref);
  if (r.status !== "TENTATIVE") throw new AgentApiError(409, "BOOKING_LOCKED", "Only a booking on option can ask for confirmation.");
  const parts = [str(body.note, 500), str(body.paymentReference, 120) ? `Payment ref: ${str(body.paymentReference, 120)}` : null].filter(Boolean);
  const c = await prisma.reservation.updateMany({
    where: { id: r.id, status: "TENTATIVE" },
    data: { confirmationRequestedAt: new Date(), confirmationNote: parts.join(" · ") || null },
  });
  if (c.count === 0) throw new AgentApiError(409, "BOOKING_LOCKED", "This booking has just changed. Reload it.");
  await notifyAgentActivity({
    enterpriseId: agent.enterpriseId,
    propertyId: r.propertyId,
    kind: "CONFIRMATION_REQUESTED",
    entityId: r.id,
    title: `${agent.sourceName} asks to confirm ${r.confirmationNo}`,
    url: (slug) => `/e/${slug}/dashboard/reservations/${r.id}`,
  });
  return getBooking(agent, propertyIds, ref);
}

function assertEditable(r: { status: string; checkInDate: Date }, dueDays: number, forGuests: boolean) {
  if (!["TENTATIVE", "RESERVED"].includes(r.status)) throw new AgentApiError(409, "BOOKING_LOCKED", "This booking can no longer be changed here.");
  if (forGuests && r.status === "RESERVED" && toUtcMidnight(new Date()).getTime() > r.checkInDate.getTime() - dueDays * DAY) {
    throw new AgentApiError(409, "BOOKING_LOCKED", "Guest details are past their due date: send a change request.");
  }
}

/** Accompanying guests: names (required), nationality, date of birth, contact. Replaces the list. */
export async function updateGuests(agent: AgentIdentity, propertyIds: string[], ref: string, body: Record<string, unknown>) {
  const r = await ownBooking(agent, propertyIds, ref);
  const { guestDetailsDueDays } = await getPropertySettings(r.propertyId);
  assertEditable(r, guestDetailsDueDays, true);
  const list = Array.isArray(body.guests) ? (body.guests as Record<string, unknown>[]) : [];
  if (list.length > r.adults + r.children + r.infants) throw new AgentApiError(400, "TOO_MANY_GUESTS", "More guests than the booking holds.");
  const upids: string[] = [];
  for (const g of list) {
    const first = str(g.firstName, 80);
    if (!first) throw new AgentApiError(400, "INVALID_BODY", "Each guest needs a first name.");
    const upid = await resolveGuestProfile({
      enterpriseId: agent.enterpriseId,
      firstName: first,
      lastName: str(g.lastName, 80),
      email: str(g.email, 200)?.toLowerCase() ?? null,
      phone: str(g.phone, 40),
      originPropertyId: r.propertyId,
    });
    const dob = typeof g.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.dateOfBirth) ? new Date(`${g.dateOfBirth}T00:00:00Z`) : undefined;
    await prisma.profile.update({
      where: { upid },
      data: { ...(str(g.nationality, 3) ? { nationality: str(g.nationality, 3)!.toUpperCase() } : {}), ...(dob ? { dateOfBirth: dob } : {}) },
    });
    if (upid !== r.primaryGuestId) upids.push(upid);
  }
  await prisma.$transaction([
    prisma.accompanyingGuest.deleteMany({ where: { reservationId: r.id } }),
    ...(upids.length ? [prisma.accompanyingGuest.createMany({ data: [...new Set(upids)].map((profileId) => ({ reservationId: r.id, profileId })) })] : []),
  ]);
  return getBooking(agent, propertyIds, ref);
}

/** International arrival and departure (flight and time), and the transfer wanted. */
export async function updateTravel(agent: AgentIdentity, propertyIds: string[], ref: string, body: Record<string, unknown>) {
  const r = await ownBooking(agent, propertyIds, ref);
  assertEditable(r, 0, false);
  for (const [key, direction] of [["arrival", "PICKUP"], ["departure", "DROPOFF"]] as const) {
    const leg = body[key] as Record<string, unknown> | null | undefined;
    if (leg === undefined) continue;
    if (leg === null) {
      await prisma.reservationTransport.deleteMany({ where: { reservationId: r.id, direction } });
      continue;
    }
    const time = typeof leg.time === "string" && !isNaN(new Date(leg.time).getTime()) ? new Date(leg.time) : null;
    const data = {
      carrierCode: str(leg.flight, 20),
      carrierTime: time,
      transportType: str(leg.transfer, 40),
      remarks: [str(leg.domesticFlight, 40) ? `Domestic: ${str(leg.domesticFlight, 40)}` : null, str(leg.notes, 300)].filter(Boolean).join(" · ") || null,
    };
    await prisma.reservationTransport.upsert({
      where: { reservationId_direction: { reservationId: r.id, direction } },
      update: data,
      create: { reservationId: r.id, direction, ...data },
    });
  }
  return getBooking(agent, propertyIds, ref);
}

/** Package name, the agent's own file number, special requests (preferred room, diet…). */
export async function updateRequests(agent: AgentIdentity, propertyIds: string[], ref: string, body: Record<string, unknown>) {
  const r = await ownBooking(agent, propertyIds, ref);
  assertEditable(r, 0, false);
  await prisma.reservation.update({
    where: { id: r.id },
    data: {
      ...("packageName" in body ? { packageName: str(body.packageName, 120) } : {}),
      ...("agentReference" in body ? { agentReference: str(body.agentReference, 80) } : {}),
      ...("requests" in body ? { remarks: str(body.requests, 1000) } : {}),
    },
  });
  return getBooking(agent, propertyIds, ref);
}

/** Cancel a booking on option, with a reason. A confirmed booking can only be asked about. */
export async function cancelBooking(agent: AgentIdentity, propertyIds: string[], ref: string, body: Record<string, unknown>) {
  const r = await ownBooking(agent, propertyIds, ref);
  if (r.status === "RESERVED") throw new AgentApiError(409, "BOOKING_LOCKED", "A confirmed booking cannot be cancelled here: send a cancellation request.");
  if (r.status !== "TENTATIVE") throw new AgentApiError(409, "BOOKING_LOCKED", "This booking can no longer be cancelled.");
  const reasonCode = str(body.reasonCode, 40);
  const reason = str(body.reason, 500);
  if (!reasonCode && !reason) throw new AgentApiError(400, "REASON_REQUIRED", "Give a reason.");
  const c = await prisma.$transaction(async (tx) => {
    const claimed = await tx.reservation.updateMany({
      where: { id: r.id, status: "TENTATIVE" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReasonCode: "AGENT_CANCELLED", cancellationReason: [reasonCode, reason].filter(Boolean).join(": ") },
    });
    if (claimed.count) await tx.folio.updateMany({ where: { reservationId: r.id, isClosed: false }, data: { isClosed: true } });
    return claimed.count;
  });
  if (!c) throw new AgentApiError(409, "BOOKING_LOCKED", "This booking has just changed. Reload it.");
  const dto = await getBooking(agent, propertyIds, ref);
  await emitAgentEvent(agent.sourceProfileId, agent.enterpriseId, "booking.cancelled", dto);
  return dto;
}

/** A request to amend or cancel a confirmed booking; the hotel decides. */
export async function createChangeRequest(agent: AgentIdentity, propertyIds: string[], ref: string, body: Record<string, unknown>) {
  const r = await ownBooking(agent, propertyIds, ref);
  if (!["RESERVED", "TENTATIVE"].includes(r.status)) throw new AgentApiError(409, "BOOKING_LOCKED", "This booking can no longer be changed.");
  const type = body.type === "CANCEL" ? "CANCEL" : body.type === "AMEND" ? "AMEND" : null;
  if (!type) throw new AgentApiError(400, "INVALID_BODY", "type is AMEND or CANCEL.");
  const note = str(body.note, 1000);
  if (type === "CANCEL" && !note && !str(body.reasonCode, 40)) throw new AgentApiError(400, "REASON_REQUIRED", "Give a reason.");
  const pending = await prisma.agentChangeRequest.count({ where: { reservationId: r.id, status: "PENDING" } });
  if (pending) throw new AgentApiError(409, "REQUEST_PENDING", "A request for this booking is already waiting for the hotel.");
  const payload = {
    ...(str(body.checkIn, 10) ? { checkIn: str(body.checkIn, 10) } : {}),
    ...(str(body.checkOut, 10) ? { checkOut: str(body.checkOut, 10) } : {}),
    ...(str(body.roomTypeId, 60) ? { roomTypeId: str(body.roomTypeId, 60) } : {}),
    ...(body.adults !== undefined ? { adults: Number(body.adults) || undefined } : {}),
    ...(str(body.reasonCode, 40) ? { reasonCode: str(body.reasonCode, 40) } : {}),
  };
  await prisma.agentChangeRequest.create({ data: { reservationId: r.id, agentUserId: agent.agentUserId, type, payload, note } });
  await notifyAgentActivity({
    enterpriseId: agent.enterpriseId,
    propertyId: r.propertyId,
    kind: "CHANGE_REQUESTED",
    entityId: r.id,
    title: `${agent.sourceName} asks to ${type === "CANCEL" ? "cancel" : "change"} ${r.confirmationNo}`,
    url: (slug) => `/e/${slug}/dashboard/reservations/${r.id}`,
  });
  return getBooking(agent, propertyIds, ref);
}

/** The next confirmation version (the PDF itself is built in confirmation-pdf.ts). */
export async function nextConfirmationVersion(agent: AgentIdentity, propertyIds: string[], ref: string) {
  const r = await ownBooking(agent, propertyIds, ref);
  if (!["TENTATIVE", "RESERVED", "IN_HOUSE"].includes(r.status)) throw new AgentApiError(409, "BOOKING_LOCKED", "There is no confirmation for this booking.");
  const updated = await prisma.reservation.update({ where: { id: r.id }, data: { agentConfirmationVersion: { increment: 1 } }, include: BOOKING_INCLUDE });
  return updated;
}

export async function ownBookingRow(agent: AgentIdentity, propertyIds: string[], ref: string) {
  return ownBooking(agent, propertyIds, ref);
}
