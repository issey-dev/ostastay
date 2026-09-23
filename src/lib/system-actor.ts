import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";
import { systemContext } from "@/lib/reservations/system-context";

// The actor the public Booking API books Excursions and Spa under
// (BOOKING_API_ADDONS_PLAN.md Phase 0 §4).
//
// Rooms get by with a synthetic userId (systemContext("website-key:<id>")) because
// createReservation only needs one for the activity log. Excursion and Spa bookings post a
// charge: ExcursionBooking.bookedByUserId, the cashier shift the charge is attributed to
// (CashierShift.userId) and the payment all need a REAL User row. One per enterprise,
// "Online Bookings", so online revenue shows as its own line in the shift/EOD summaries
// instead of landing in whichever receptionist's drawer happened to be open.
//
// The account can never be used to sign in: inactive (login refuses inactive users), a
// password hash of 32 random bytes nobody ever saw, an address on the reserved .invalid
// TLD, and isSystem so staff lists and user management leave it out.

export const SYSTEM_USER_FIRST_NAME = "Online";
export const SYSTEM_USER_LAST_NAME = "Bookings";

function systemUserEmail(enterpriseId: string): string {
  return `online-bookings.${enterpriseId}@system.invalid`;
}

export async function ensureSystemUser(enterpriseId: string) {
  const email = systemUserEmail(enterpriseId);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  try {
    return await prisma.user.create({
      data: {
        enterpriseId,
        email,
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
        firstName: SYSTEM_USER_FIRST_NAME,
        lastName: SYSTEM_USER_LAST_NAME,
        scope: "ENTERPRISE",
        isActive: false,
        isSystem: true,
      },
    });
  } catch (e) {
    // Two first bookings raced to create it; the unique email makes the loser fail.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.user.findUniqueOrThrow({ where: { email } });
    }
    throw e;
  }
}

/** An AuthContext acting as the enterprise's Online Bookings user. It carries no role
 *  permissions: services that need a decision about overrides or voids take it as an
 *  explicit argument (e.g. SpaAuthority), never from this context. */
export async function systemActorContext(enterpriseId: string): Promise<AuthContext> {
  const user = await ensureSystemUser(enterpriseId);
  return systemContext(enterpriseId, user.id);
}
