import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";
import { resolveBusinessDate } from "@/lib/business-date";

// A cashier shift belongs to (userId, propertyId): a front-desk user keeps a
// separate drawer per property they work in. This is the single place that finds
// or auto-opens that drawer, so every billing entry point (folio charge, folio
// payment, POS, and the explicit "open billing screen" ensure call) agrees on it.

// The user's currently-open shift for a specific property, or null.
export function findOpenShift(userId: string, propertyId: string) {
  return prisma.cashierShift.findFirst({
    where: { userId, propertyId, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
}

// Find or auto-open the caller's open shift for `propertyId`. Auto-opened shifts
// start at 0 float (the "just opened a billing screen, nothing posted yet" case);
// the user can still record a real opening float from the Cashiering screen. The
// shift is stamped with the property's business date at open time so the EOD
// Cashier Summary can group by (property, business date).
export async function ensureOpenShift(ctx: AuthContext, propertyId: string) {
  const existing = await findOpenShift(ctx.userId, propertyId);
  if (existing) return existing;

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  const businessDate = property ? resolveBusinessDate(property) : null;

  try {
    return await prisma.cashierShift.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        userId: ctx.userId,
        propertyId,
        businessDate,
        openingFloat: 0,
      },
    });
  } catch (e) {
    // A concurrent first-posting raced us to open the drawer. The partial unique index
    // (one open shift per user+property, migration 20260725150000) rejects the second
    // insert — return the shift that actually won instead of erroring or duplicating.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await findOpenShift(ctx.userId, propertyId);
      if (raced) return raced;
    }
    throw e;
  }
}
