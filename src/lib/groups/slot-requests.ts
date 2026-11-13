import { prisma } from "@/lib/db";
import { requireCapability, type AuthContext } from "@/lib/scope";
import { minTypeAvailability } from "@/lib/availability";
import { toUtcMidnight } from "@/lib/business-date";
import { logActivity } from "@/lib/activity-log";
import { overflowRoomType } from "@/lib/reservations/overflow";

// Slot requests (Agent Portal plan A-7, A-11, A-12; Phase 4, 9.4.0).
//
// A Source asks for a slot: a date period and rooms per type. That is a GroupBlock in
// REQUESTED, which holds nothing, so a request changes no availability number anywhere.
// Staff approve it, possibly changing dates, rooms, cutoff rules and elasticity; the
// availability check that guards every block runs at that moment, and the block becomes
// TENTATIVE (rooms held, bookings may be entered). Or staff decline it with a reason.
// Overflow requests (house full, partner hotel) are approved without an availability check
// because they sit in the OVF pseudo type; a person always decides them.

export class SlotError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

const DAY = 86_400_000;
export type SlotRoom = { roomTypeId: string; quantity: number };
export type SlotRules = {
  cutoffDate?: Date | null;
  releaseDays?: number | null;
  elasticRooms?: number;
  elasticNightsBefore?: number;
  elasticNightsAfter?: number;
  checkpoints?: { date: Date; minPercent: number }[];
};

/**
 * A-11: when may this Source request slots on this property? Each negotiated plan linked to
 * the Source may carry agentSalesOpenAt; the Source may start `earlyAccessDays` before it.
 * The window is open once ANY linked plan's window is open; a Source linked to plans with no
 * window set (or to none) is always open. Returns the opening moment when still closed.
 */
export async function salesWindowOpensAt(sourceUpid: string, propertyId: string, now = new Date()): Promise<Date | null> {
  const source = await prisma.profile.findUnique({ where: { upid: sourceUpid }, select: { earlyAccessDays: true } });
  const links = await prisma.ratePlanAgentAccess.findMany({
    where: { upid: sourceUpid, ratePlan: { propertyId } },
    select: { ratePlan: { select: { agentSalesOpenAt: true } } },
  });
  const opens = links.map((l) => l.ratePlan.agentSalesOpenAt);
  if (opens.length === 0 || opens.some((o) => !o)) return null;
  const early = (source?.earlyAccessDays ?? 0) * DAY;
  const earliest = Math.min(...opens.map((o) => o!.getTime() - early));
  return earliest > now.getTime() ? new Date(earliest) : null;
}

function cleanRooms(rooms: unknown): SlotRoom[] {
  if (!Array.isArray(rooms)) return [];
  const byType = new Map<string, number>();
  for (const r of rooms as Record<string, unknown>[]) {
    const id = String(r?.roomTypeId ?? "");
    const q = Number(r?.quantity);
    if (id && Number.isInteger(q) && q > 0 && q <= 500) byType.set(id, (byType.get(id) ?? 0) + q);
  }
  return [...byType.entries()].map(([roomTypeId, quantity]) => ({ roomTypeId, quantity }));
}

async function nextRequestCode(propertyId: string) {
  for (let i = 0; i < 6; i++) {
    const code = `REQ-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;
    const taken = await prisma.groupBlock.findUnique({ where: { propertyId_code: { propertyId, code } }, select: { id: true } });
    if (!taken) return code;
  }
  throw new SlotError(500, "Could not number the request; try again.");
}

/** A new slot request. Used by staff (on behalf of a Source) and by the Agent API. */
export async function createSlotRequest(input: {
  enterpriseId: string;
  propertyId: string;
  sourceProfileId: string;
  startDate: Date;
  endDate: Date;
  rooms: unknown;
  note?: string | null;
  isOverflow?: boolean;
  origin?: "DESK" | "AGENT_PORTAL";
  requestedByAgentUserId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const property = await prisma.property.findUnique({ where: { id: input.propertyId }, select: { enterpriseId: true, businessDate: true } });
  if (!property || property.enterpriseId !== input.enterpriseId) throw new SlotError(404, "Property not found");
  const source = await prisma.profile.findUnique({ where: { upid: input.sourceProfileId } });
  if (!source || source.enterpriseId !== input.enterpriseId || source.profileType !== "SOURCE") throw new SlotError(404, "Source not found");
  if (!source.isActive) throw new SlotError(403, "This source is not active.", "AGENT_NOT_ACTIVE");

  const start = toUtcMidnight(input.startDate);
  const end = toUtcMidnight(input.endDate);
  if (!(end > start)) throw new SlotError(400, "The slot must end after it starts.");
  const floor = toUtcMidnight(property.businessDate ?? now);
  if (start < floor) throw new SlotError(400, "A slot cannot start in the past.");
  if ((end.getTime() - start.getTime()) / DAY > 366) throw new SlotError(400, "A slot can cover at most a year.");

  const opensAt = await salesWindowOpensAt(source.upid, input.propertyId, now);
  if (opensAt) {
    throw new SlotError(403, `Sales for these rates open to you on ${opensAt.toISOString().slice(0, 10)}.`, "NOT_ON_SALE_YET", { opensAt });
  }

  let rooms = cleanRooms(input.rooms);
  if (input.isOverflow) {
    const total = rooms.reduce((s, r) => s + r.quantity, 0);
    if (total < 1) throw new SlotError(400, "Say how many rooms are needed.");
    const ovf = await overflowRoomType(input.propertyId);
    rooms = [{ roomTypeId: ovf.id, quantity: total }];
  } else {
    if (rooms.length === 0) throw new SlotError(400, "Ask for at least one room.");
    const types = await prisma.roomType.findMany({
      where: { id: { in: rooms.map((r) => r.roomTypeId) }, propertyId: input.propertyId, isPseudo: false, isActive: true },
      select: { id: true },
    });
    if (types.length !== rooms.length) throw new SlotError(400, "A room type in the request is not available at this property.");
  }

  const code = await nextRequestCode(input.propertyId);
  const name = `${source.companyName || source.firstName} ${start.toISOString().slice(0, 10)}`;
  const block = await prisma.groupBlock.create({
    data: {
      propertyId: input.propertyId,
      code,
      name: name.slice(0, 120),
      startDate: start,
      endDate: end,
      status: "REQUESTED",
      sourceProfileId: source.upid,
      origin: input.origin ?? "DESK",
      requestedByAgentUserId: input.requestedByAgentUserId ?? null,
      requestNote: input.note?.trim()?.slice(0, 1000) || null,
      isOverflowRequest: !!input.isOverflow,
      // Stored as the proposal; a REQUESTED block holds nothing (availability filters on status).
      totalRoomsHeld: rooms.reduce((s, r) => s + r.quantity, 0),
      roomHolds: { create: rooms.map((r) => ({ roomTypeId: r.roomTypeId, quantity: r.quantity, requestedQuantity: r.quantity })) },
    },
    include: { roomHolds: true },
  });
  return block;
}

async function loadRequest(ctx: AuthContext, id: string) {
  const b = await prisma.groupBlock.findUnique({
    where: { id },
    include: { roomHolds: true, property: { select: { enterpriseId: true, businessDate: true } } },
  });
  if (!b || b.property.enterpriseId !== ctx.enterpriseId) throw new SlotError(404, "Slot request not found");
  if (ctx.scope === "PROPERTY" && ctx.propertyId !== b.propertyId) throw new SlotError(404, "Slot request not found");
  return b;
}

/**
 * Approve (possibly with changes). Runs the availability check for every held type, as for
 * any block; on failure nothing changes and the nights that fail are returned so staff can
 * reduce the numbers. The block becomes TENTATIVE (owner, 2026-11-11: tentative first).
 */
export async function approveSlotRequest(
  ctx: AuthContext,
  id: string,
  changes: { startDate?: Date; endDate?: Date; rooms?: unknown; rules?: SlotRules; note?: string | null } = {}
) {
  requireCapability(ctx, "groups.decideSlotRequest");
  const b = await loadRequest(ctx, id);
  if (b.status !== "REQUESTED") throw new SlotError(409, "Only a pending request can be approved.", "SLOT_NOT_APPROVED");

  const start = changes.startDate ? toUtcMidnight(changes.startDate) : b.startDate;
  const end = changes.endDate ? toUtcMidnight(changes.endDate) : b.endDate;
  if (!(end > start)) throw new SlotError(400, "The slot must end after it starts.");
  const rooms = changes.rooms !== undefined ? cleanRooms(changes.rooms) : b.roomHolds.map((h) => ({ roomTypeId: h.roomTypeId, quantity: h.quantity }));
  if (rooms.length === 0) throw new SlotError(400, "Approve at least one room, or decline the request.");

  if (!b.isOverflowRequest) {
    const short: string[] = [];
    for (const r of rooms) {
      const free = await minTypeAvailability({ propertyId: b.propertyId, roomTypeId: r.roomTypeId, startDate: start, endDate: end, excludeGroupBlockId: b.id });
      if (free < r.quantity) {
        const t = await prisma.roomType.findUnique({ where: { id: r.roomTypeId }, select: { name: true } });
        short.push(`${t?.name ?? "Room type"}: ${free} free across the dates, ${r.quantity} asked`);
      }
    }
    if (short.length > 0) throw new SlotError(409, `Not enough rooms: ${short.join("; ")}.`, "NO_AVAILABILITY", { short });
  }

  const rules = changes.rules ?? {};
  const requested = new Map(b.roomHolds.map((h) => [h.roomTypeId, h.requestedQuantity ?? h.quantity]));
  const now = new Date();
  const claimed = await prisma.$transaction(async (tx) => {
    const c = await tx.groupBlock.updateMany({
      where: { id, status: "REQUESTED" },
      data: {
        status: "TENTATIVE",
        startDate: start,
        endDate: end,
        totalRoomsHeld: rooms.reduce((s, r) => s + r.quantity, 0),
        decidedBy: ctx.userId,
        decidedAt: now,
        decisionReason: changes.note?.trim() || null,
        ...(rules.cutoffDate !== undefined ? { cutoffDate: rules.cutoffDate ? toUtcMidnight(rules.cutoffDate) : null } : {}),
        ...(rules.releaseDays !== undefined ? { releaseDays: rules.releaseDays } : {}),
        ...(rules.elasticRooms !== undefined ? { elasticRooms: Math.max(0, rules.elasticRooms) } : {}),
        ...(rules.elasticNightsBefore !== undefined ? { elasticNightsBefore: Math.max(0, rules.elasticNightsBefore) } : {}),
        ...(rules.elasticNightsAfter !== undefined ? { elasticNightsAfter: Math.max(0, rules.elasticNightsAfter) } : {}),
      },
    });
    if (c.count === 0) return false;
    await tx.groupBlockRoom.deleteMany({ where: { groupBlockId: id } });
    await tx.groupBlockRoom.createMany({
      data: rooms.map((r) => ({ groupBlockId: id, roomTypeId: r.roomTypeId, quantity: r.quantity, requestedQuantity: requested.get(r.roomTypeId) ?? 0 })),
    });
    if (rules.checkpoints) {
      await tx.groupBlockCheckpoint.deleteMany({ where: { groupBlockId: id } });
      if (rules.checkpoints.length) {
        await tx.groupBlockCheckpoint.createMany({
          data: rules.checkpoints.map((cp) => ({ groupBlockId: id, date: toUtcMidnight(cp.date), minPercent: Math.min(100, Math.max(1, Math.round(cp.minPercent))) })),
        });
      }
    }
    return true;
  });
  if (!claimed) throw new SlotError(409, "This request was just decided by someone else.", "SLOT_NOT_APPROVED");
  await logActivity({
    ctx,
    module: "GROUP_BLOCKS",
    action: "UPDATE",
    entityType: "GroupBlock",
    entityId: id,
    description: `Approved slot request ${b.code} (${rooms.reduce((s, r) => s + r.quantity, 0)} rooms)`,
  });
  return prisma.groupBlock.findUnique({ where: { id }, include: { roomHolds: true, checkpoints: true } });
}

/** Decline with a reason (terminal). */
export async function declineSlotRequest(ctx: AuthContext, id: string, reason: string) {
  requireCapability(ctx, "groups.decideSlotRequest");
  const text = reason?.trim();
  if (!text) throw new SlotError(400, "Give a reason.", "REASON_REQUIRED");
  const b = await loadRequest(ctx, id);
  const c = await prisma.groupBlock.updateMany({
    where: { id, status: "REQUESTED" },
    data: { status: "DECLINED", decisionReason: text.slice(0, 1000), decidedBy: ctx.userId, decidedAt: new Date() },
  });
  if (c.count === 0) throw new SlotError(409, "Only a pending request can be declined.", "SLOT_NOT_APPROVED");
  await logActivity({ ctx, module: "GROUP_BLOCKS", action: "UPDATE", entityType: "GroupBlock", entityId: id, description: `Declined slot request ${b.code}: ${text}` });
  return prisma.groupBlock.findUnique({ where: { id } });
}

/** An agent withdraws its own pending request (Agent API): DECLINED, reason "withdrawn". */
export async function withdrawSlotRequest(blockId: string, sourceProfileId: string) {
  const c = await prisma.groupBlock.updateMany({
    where: { id: blockId, sourceProfileId, status: "REQUESTED" },
    data: { status: "DECLINED", decisionReason: "withdrawn", decidedAt: new Date() },
  });
  if (c.count === 0) throw new SlotError(409, "Only a pending request can be withdrawn.", "SLOT_NOT_APPROVED");
}
