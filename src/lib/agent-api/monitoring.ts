import { prisma } from "@/lib/db";

// Agent portal health for the platform Monitoring page (Agent Portal plan Phase 9). Scoped
// like the rest of the page: all enterprises, one enterprise, or one property (agent logins
// belong to an enterprise, so a property scope counts its enterprise's logins and that
// property's bookings). Returns null when no agent login exists in the scope, so enterprises
// that do not use the portal show no tile.
export type AgentPortalStats = {
  logins: number;
  signIns: number;
  lockedNow: number;
  bookings: number;
  pendingChanges: number;
  staleChanges: number;
};

const STALE_MS = 24 * 3_600_000;

export async function agentPortalStats(from: Date, enterpriseId: string | null, propertyId: string | null): Promise<AgentPortalStats | null> {
  const userWhere = enterpriseId ? { enterpriseId } : {};
  const resWhere = propertyId ? { propertyId } : enterpriseId ? { property: { enterpriseId } } : {};
  const now = new Date();
  const logins = await prisma.agentUser.count({ where: { ...userWhere, status: { not: "SUSPENDED" } } });
  if (logins === 0) return null;
  const [signIns, lockedNow, bookings, pendingChanges, staleChanges] = await Promise.all([
    prisma.agentSession.count({ where: { createdAt: { gte: from }, agentUser: userWhere } }),
    prisma.agentUser.count({ where: { ...userWhere, lockedUntil: { gt: now } } }),
    prisma.reservation.count({ where: { ...resWhere, agentUserId: { not: null }, createdAt: { gte: from } } }),
    prisma.agentChangeRequest.count({ where: { status: "PENDING", reservation: resWhere } }),
    prisma.agentChangeRequest.count({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - STALE_MS) }, reservation: resWhere } }),
  ]);
  return { logins, signIns, lockedNow, bookings, pendingChanges, staleChanges };
}
