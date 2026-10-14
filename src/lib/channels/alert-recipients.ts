import { prisma } from "@/lib/db";

/**
 * Who in an enterprise should be told a channel connection just broke: active users whose
 * role can UPDATE the INTEGRATIONS module — the same permission that lets them Check or
 * Re-authorize it — and who may see that property. An ENTERPRISE-scope user sees every
 * property; a PROPERTY-scope user only their own.
 *
 * Returns each recipient with the property ids they may act on, so the caller can tell each
 * person only about connections they are able to fix.
 */
export async function getChannelAlertRecipients(
  enterpriseId: string,
  propertyIds: string[]
): Promise<{ email: string; firstName: string; propertyIds: string[] }[]> {
  if (propertyIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: {
      enterpriseId,
      isActive: true,
      roles: { some: { role: { permissions: { some: { module: "INTEGRATIONS", canUpdate: true } } } } },
      OR: [{ scope: "ENTERPRISE" }, { scope: "PROPERTY", propertyId: { in: propertyIds } }],
    },
    select: { email: true, firstName: true, scope: true, propertyId: true },
  });
  return users.map((u) => ({
    email: u.email,
    firstName: u.firstName,
    propertyIds: u.scope === "PROPERTY" ? propertyIds.filter((id) => id === u.propertyId) : propertyIds,
  }));
}
