import { prisma } from "@/lib/db";

/**
 * Find an existing guest Profile by email within the enterprise, or create a minimal one.
 *
 * Mirrors the find-or-create shape the group-block pickup flow uses
 * (src/app/api/groups/[id]/pickup/route.ts) — Profile has no email column of its own;
 * email and phone live in ProfileCommunication.
 *
 * Shared by the two system-driven booking paths: channel conversion
 * (src/lib/channels/inbound/convert.ts) and the Website API
 * (src/lib/website-api/booking.ts). A channel booking without bookings-personal scope
 * arrives with no guest name at all; "Guest" is a discoverable placeholder rather than a
 * blocked conversion, since the room is genuinely booked whether or not we yet know who
 * is coming. A website booking always carries a name (the API requires one).
 *
 * Email matching is exact on the stored value. Callers that accept free-typed input (the
 * website) should normalise (trim + lower-case) BEFORE calling so a returning guest who
 * types their address with different capitalisation lands on the same profile.
 */
export async function resolveGuestProfile(params: {
  enterpriseId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone?: string | null;
  /** "First seen at" breadcrumb — see Profile.originPropertyId. */
  originPropertyId?: string | null;
}): Promise<string> {
  const { enterpriseId, firstName, lastName, email, phone, originPropertyId } = params;

  if (email) {
    const existing = await prisma.profile.findFirst({
      where: { enterpriseId, communications: { some: { type: "EMAIL", value: email } } },
      select: { upid: true },
    });
    if (existing) return existing.upid;
  }

  const communications: { type: string; value: string; isPrimary: boolean }[] = [];
  if (email) communications.push({ type: "EMAIL", value: email, isPrimary: true });
  if (phone) communications.push({ type: "MOBILE", value: phone, isPrimary: true });

  const created = await prisma.profile.create({
    data: {
      enterpriseId,
      profileType: "GUEST",
      firstName: firstName || "Guest",
      lastName: lastName || null,
      originPropertyId: originPropertyId ?? null,
      communications: communications.length ? { create: communications } : undefined,
    },
    select: { upid: true },
  });
  return created.upid;
}
