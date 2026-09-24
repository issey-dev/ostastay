import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Connect a property to the channel manager the way the Osta console leaves it — one
 * connection per property, created together with that property's link — without the
 * Beds24 invite-code exchange (tests that exercise the exchange call createConnection).
 * The connection carries a dummy stored credential so token-dependent code has one.
 */
export async function connectProperty(
  propertyId: string,
  opts: {
    externalPropertyId?: string;
    name?: string;
    syncEnabled?: boolean;
    /** Extra ChannelConnection columns (webhookTokenHash, rate-limit state, ...). */
    connection?: Partial<Prisma.ChannelConnectionUncheckedCreateInput>;
  } = {}
) {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { enterpriseId: true } });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const connection = await prisma.channelConnection.create({
    data: {
      enterpriseId: property.enterpriseId,
      propertyId,
      provider: "BEDS24",
      name: opts.name ?? `Conn ${suffix}`,
      refreshToken: "x",
      ...opts.connection,
    },
  });
  const link = await prisma.channelPropertyLink.create({
    data: {
      connectionId: connection.id,
      propertyId,
      externalPropertyId: opts.externalPropertyId ?? `ext-${suffix}`,
      syncEnabled: opts.syncEnabled ?? false,
    },
  });
  return { connection, link };
}

/** A fresh property to connect — a connection serves exactly one property. */
export async function makeChannelProperty(enterpriseId: string, name = "Channel Property") {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return prisma.property.create({
    data: {
      enterpriseId, name, code: `CH-${suffix}`, legalName: `${name} LLC`,
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
}

/** What createConnection needs besides a name and invite code: a fresh property of the
 *  enterprise and that property's id in the channel manager. */
export async function channelTarget(enterpriseId: string) {
  const property = await makeChannelProperty(enterpriseId);
  return { propertyId: property.id, externalPropertyId: `ext-${property.code}` };
}
