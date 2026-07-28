import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireSession, toErrorResponse } from "@/lib/scope";

// Tells the browser what End-of-Day is doing to the property this session is working in.
//
// This is the one route that must survive the EOD lockout (allowDuringEodLockout) — if
// it 401'd like everything else, the client would only ever see a generic auth failure
// and couldn't explain *why* the user is being signed out. Every other route takes the
// throw from requireSession().
export async function GET() {
  try {
    const ctx = await requireSession({ allowDuringEodLockout: true });
    if (!ctx.sessionPropertyId) {
      return NextResponse.json({ eodInProgress: false, forcedLogout: false });
    }

    const session = await getSession();
    const [property, activeRun] = await Promise.all([
      prisma.property.findUnique({
        where: { id: ctx.sessionPropertyId },
        select: { name: true, eodSessionsInvalidAt: true, businessDate: true },
      }),
      prisma.eodRun.findFirst({
        where: { propertyId: ctx.sessionPropertyId, status: "IN_PROGRESS" },
        select: { businessDate: true },
      }),
    ]);

    // Same comparison requireSession() makes — kept here rather than reported by it so
    // this route can describe the lockout instead of being stopped by it.
    const iatMs = typeof session?.iat === "number" ? session.iat * 1000 : null;
    const forcedLogout =
      !!property?.eodSessionsInvalidAt &&
      iatMs !== null &&
      iatMs < property.eodSessionsInvalidAt.getTime();

    return NextResponse.json({
      propertyName: property?.name ?? null,
      eodInProgress: !!activeRun,
      // The date being closed while the roll is running; after it, the new open date.
      businessDate: (activeRun?.businessDate ?? property?.businessDate)?.toISOString() ?? null,
      forcedLogout,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
