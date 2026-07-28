import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { getProvider } from "@/lib/channels/providers/registry";

// Sharing / mapping: which properties a channel-manager connection covers, and how this
// system's room types and rate plans correspond to the channel manager's own.
// See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Everything here treats properties as CONFIGURATION rather than as somewhere work happens,
// which is why it belongs in the Hub: a link is a statement about how a property is
// connected, not an operation on it.

export type PublicRoomTypeMap = {
  roomTypeId: string;
  roomTypeName: string;
  roomTypeCode: string;
  isActive: boolean;
  externalRoomId: string | null;
  shared: boolean;
};

export type PublicRatePlanMap = {
  ratePlanId: string;
  ratePlanName: string;
  ratePlanCode: string;
  externalRateId: string | null;
};

export type PublicPropertyLink = {
  id: string;
  connectionId: string;
  connectionName: string;
  propertyId: string;
  propertyName: string;
  externalPropertyId: string;
  syncEnabled: boolean;
  roomTypes: PublicRoomTypeMap[];
  ratePlans: PublicRatePlanMap[];
  /** Active, shared room types still missing an external id. */
  unmappedRoomTypeCount: number;
  /** False while anything required is unmapped — see assertReadyToEnable(). */
  ready: boolean;
};

/**
 * A link is READY only when every active, shared room type has an external id.
 *
 * Rate plans deliberately do NOT gate readiness: a property can push availability against a
 * single default rate long before per-plan rate mapping is set up, and blocking on it would
 * stop people connecting at all.
 *
 * Room types are different. Pushing availability for a room type the channel manager cannot
 * identify either silently drops that inventory or attaches it to the wrong room — the first
 * is lost revenue, the second is a guest arriving to a room type nobody sold them.
 */
export function computeReadiness(roomTypes: PublicRoomTypeMap[]): { unmapped: number; ready: boolean } {
  const requiring = roomTypes.filter((rt) => rt.isActive && rt.shared);
  const unmapped = requiring.filter((rt) => !rt.externalRoomId).length;
  // A link with no shared active room types at all is not "ready" — there would be nothing
  // to sell, and silently enabling it would look like success.
  return { unmapped, ready: requiring.length > 0 && unmapped === 0 };
}

/** Confirms a link exists AND belongs to the caller's enterprise. Generic message either way. */
export async function assertLinkInEnterprise(linkId: string, enterpriseId: string) {
  const link = await prisma.channelPropertyLink.findUnique({
    where: { id: linkId },
    include: { connection: true },
  });
  if (!link || link.connection.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Link not found");
  }
  return link;
}

export async function listPropertyLinks(enterpriseId: string): Promise<PublicPropertyLink[]> {
  const links = await prisma.channelPropertyLink.findMany({
    where: { connection: { enterpriseId } },
    include: {
      connection: { select: { id: true, name: true } },
      property: { select: { id: true, name: true } },
      roomTypeMaps: true,
      ratePlanMaps: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(
    links.map(async (link) => {
      // Every room type of the linked property, not just the mapped ones — an unmapped room
      // type is the thing the operator most needs to see.
      const [roomTypes, ratePlans] = await Promise.all([
        prisma.roomType.findMany({
          where: { propertyId: link.propertyId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, code: true, isActive: true },
        }),
        prisma.ratePlan.findMany({
          where: { propertyId: link.propertyId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, code: true },
        }),
      ]);

      const rtMapById = new Map(link.roomTypeMaps.map((m) => [m.roomTypeId, m]));
      const rpMapById = new Map(link.ratePlanMaps.map((m) => [m.ratePlanId, m]));

      const roomTypeRows: PublicRoomTypeMap[] = roomTypes.map((rt) => ({
        roomTypeId: rt.id,
        roomTypeName: rt.name,
        roomTypeCode: rt.code,
        isActive: rt.isActive,
        externalRoomId: rtMapById.get(rt.id)?.externalRoomId ?? null,
        shared: rtMapById.get(rt.id)?.shared ?? true,
      }));

      const { unmapped, ready } = computeReadiness(roomTypeRows);

      return {
        id: link.id,
        connectionId: link.connection.id,
        connectionName: link.connection.name,
        propertyId: link.property.id,
        propertyName: link.property.name,
        externalPropertyId: link.externalPropertyId,
        syncEnabled: link.syncEnabled,
        roomTypes: roomTypeRows,
        ratePlans: ratePlans.map((rp) => ({
          ratePlanId: rp.id,
          ratePlanName: rp.name,
          ratePlanCode: rp.code,
          externalRateId: rpMapById.get(rp.id)?.externalRateId ?? null,
        })),
        unmappedRoomTypeCount: unmapped,
        ready,
      };
    })
  );
}

/**
 * Link a property to a connection.
 *
 * The property must belong to the caller's enterprise — checked here rather than trusted
 * from the request, since a link is what decides whose inventory gets published.
 */
export async function createPropertyLink(params: {
  enterpriseId: string;
  connectionId: string;
  propertyId: string;
  externalPropertyId: string;
}) {
  const { enterpriseId, connectionId, propertyId, externalPropertyId } = params;

  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Connection not found");
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Property not found");
  }

  // Caught here for a clear message; the DB's unique constraint on propertyId is the real
  // guarantee. Two connections selling one property's rooms is a double-sell that shows up
  // as an overbooked guest at the desk, never as an error in software.
  const existing = await prisma.channelPropertyLink.findUnique({ where: { propertyId } });
  if (existing) {
    throw new ForbiddenError("This property is already linked to a channel manager");
  }

  return prisma.channelPropertyLink.create({
    data: { connectionId, propertyId, externalPropertyId, syncEnabled: false },
  });
}

/** Map (or re-map) one room type. Passing a blank external id clears the mapping. */
export async function setRoomTypeMapping(params: {
  enterpriseId: string;
  linkId: string;
  roomTypeId: string;
  externalRoomId: string;
  shared?: boolean;
}) {
  const { enterpriseId, linkId, roomTypeId, externalRoomId, shared } = params;
  const link = await assertLinkInEnterprise(linkId, enterpriseId);

  // The room type must belong to THIS link's property. Without this check a mapping could
  // point one property's room type at another property's channel-manager room — inventory
  // published under the wrong roof.
  const roomType = await prisma.roomType.findUnique({ where: { id: roomTypeId } });
  if (!roomType || roomType.propertyId !== link.propertyId) {
    throw new ForbiddenError("Room type does not belong to this property");
  }

  if (!externalRoomId.trim()) {
    await prisma.channelRoomTypeMap.deleteMany({ where: { roomTypeId } });
    return null;
  }

  return prisma.channelRoomTypeMap.upsert({
    where: { roomTypeId },
    update: { externalRoomId: externalRoomId.trim(), linkId, ...(shared === undefined ? {} : { shared }) },
    create: { linkId, roomTypeId, externalRoomId: externalRoomId.trim(), shared: shared ?? true },
  });
}

export async function setRatePlanMapping(params: {
  enterpriseId: string;
  linkId: string;
  ratePlanId: string;
  externalRateId: string;
}) {
  const { enterpriseId, linkId, ratePlanId, externalRateId } = params;
  const link = await assertLinkInEnterprise(linkId, enterpriseId);

  const ratePlan = await prisma.ratePlan.findUnique({ where: { id: ratePlanId } });
  if (!ratePlan || ratePlan.propertyId !== link.propertyId) {
    throw new ForbiddenError("Rate plan does not belong to this property");
  }

  // What counts as a valid external rate id is provider-specific — Beds24 exposes SIXTEEN
  // NUMBERED PRICE SLOTS (price1..price16) rather than named rates, so a mapping stores a
  // slot number there, not an arbitrary id (see src/lib/channels/payload.ts). Dispatched
  // through the link's own connection so a differently-shaped provider validates by its own
  // rule without this function needing to know about it.
  const provider = getProvider(link.connection.provider);
  const trimmedRate = externalRateId.trim();
  if (trimmedRate && !provider.isValidRateId(trimmedRate)) {
    throw new ForbiddenError(`Invalid ${provider.rateIdLabel.toLowerCase()}`);
  }

  if (!externalRateId.trim()) {
    await prisma.channelRatePlanMap.deleteMany({ where: { ratePlanId } });
    return null;
  }

  return prisma.channelRatePlanMap.upsert({
    where: { ratePlanId },
    update: { externalRateId: externalRateId.trim(), linkId },
    create: { linkId, ratePlanId, externalRateId: externalRateId.trim() },
  });
}

/**
 * Turn sharing on or off for a link.
 *
 * Enabling is REFUSED while any active shared room type is unmapped. Turning sharing on is
 * the moment inventory starts being published, so it is the right place to insist the
 * mapping is complete — a half-mapped push is worse than no push, because it looks like it
 * worked. Disabling is always allowed: stopping is never something to block.
 */
export async function setSyncEnabled(params: { enterpriseId: string; linkId: string; enabled: boolean }) {
  const { enterpriseId, linkId, enabled } = params;
  await assertLinkInEnterprise(linkId, enterpriseId);

  if (enabled) {
    const links = await listPropertyLinks(enterpriseId);
    const link = links.find((l) => l.id === linkId);
    if (!link?.ready) {
      throw new ForbiddenError(
        link && link.unmappedRoomTypeCount > 0
          ? `${link.unmappedRoomTypeCount} active room type(s) are not mapped yet`
          : "Nothing is mapped to share yet"
      );
    }
  }

  return prisma.channelPropertyLink.update({ where: { id: linkId }, data: { syncEnabled: enabled } });
}

export async function deletePropertyLink(enterpriseId: string, linkId: string) {
  await assertLinkInEnterprise(linkId, enterpriseId);
  // Mappings cascade with the link — they are meaningless without it.
  await prisma.channelPropertyLink.delete({ where: { id: linkId } });
}
