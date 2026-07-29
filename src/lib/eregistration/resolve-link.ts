import { prisma } from "@/lib/db";
import { hashEregistrationToken } from "@/lib/eregistration/token";

export type LinkResolution =
  | { ok: true; link: NonNullable<Awaited<ReturnType<typeof prisma.eRegistrationLink.findUnique>>> }
  | { ok: false; status: number; error: string };

// The one place every guest-facing route resolves a token. Scoping (reservationId,
// propertyId, enterpriseId) always comes from the resolved row itself, never from a
// client-supplied param — mirrors src/app/api/channels/webhook/[token]/route.ts.
//
// A generic error message on every rejected outcome (not found vs. expired vs. revoked
// all read the same to the guest) — a token is a bearer credential, and a
// distinguishable response would let its validity be probed.
//
// COMPLETED is resolvable, not rejected — it's an informational label for staff ("every
// slot under this link finished at some point"), not a revocation. Rejecting it would
// mean a link auto-flips unusable the instant its last slot is finalized, which breaks
// a legitimate staff reopen-then-guest-corrects flow through the SAME link: the slot's
// own status (SUBMITTED/APPLIED, locked against PATCH/finalize) is what actually gates
// correctness, exactly as the per-route comments already say. Only REVOKED and an
// expired ACTIVE link are genuinely dead.
export async function resolveEregistrationLink(token: string): Promise<LinkResolution> {
  if (!token || typeof token !== "string") {
    return { ok: false, status: 404, error: "This link is invalid." };
  }
  const tokenHash = hashEregistrationToken(token);
  const link = await prisma.eRegistrationLink.findUnique({ where: { tokenHash } });
  if (!link) {
    return { ok: false, status: 404, error: "This link is invalid." };
  }
  const expired = link.status === "ACTIVE" && link.expiresAt.getTime() < Date.now();
  if (expired) {
    return { ok: false, status: 410, error: "This link is no longer active. Please contact the property for a new one." };
  }
  if (link.status === "REVOKED") {
    return { ok: false, status: 410, error: "This link is no longer active. Please contact the property for a new one." };
  }
  return { ok: true, link };
}

// Every reservation a link's slots can legitimately belong to — one for a reservation-
// scoped link, every non-cancelled current pickup for a group-scoped one.
export async function reservationIdsForLink(link: { reservationId: string | null; groupBlockId: string | null }): Promise<string[]> {
  if (link.reservationId) return [link.reservationId];
  if (link.groupBlockId) {
    const pickups = await prisma.reservation.findMany({
      where: { groupBlockId: link.groupBlockId, status: { notIn: ["CANCELLED"] } },
      select: { id: true },
    });
    return pickups.map((p) => p.id);
  }
  return [];
}
