import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { toUtcMidnight } from "@/lib/business-date";

const DAY_MS = 86_400_000;
// A single Stop-Sale mutation can't span more than ~2 years — guards against a huge
// range creating tens of thousands of rows in one transaction.
const MAX_RANGE_DAYS = 731;

// Parse a Stop-Sale mutation body shared by POST (close) and DELETE (open).
//   propertyId   required
//   startDate    YYYY-MM-DD, first date to affect (inclusive)
//   endDate      YYYY-MM-DD, last date to affect (inclusive); defaults to startDate
//   roomTypeIds  omitted/empty → PROPERTY-WIDE closure (roomTypeId null); otherwise one
//                row per listed room type per date
async function parseBody(request: Request) {
  const body = await request.json();
  const propertyId: string | undefined = body.propertyId;
  if (!propertyId) return { error: "propertyId is required" as const };

  const start = toUtcMidnight(new Date(body.startDate));
  const end = body.endDate ? toUtcMidnight(new Date(body.endDate)) : start;
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return { error: "Invalid date range" as const };
  }
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    return { error: `Date range too large (max ${MAX_RANGE_DAYS} days)` as const };
  }

  const dates: Date[] = [];
  for (let ms = start.getTime(); ms <= end.getTime(); ms += DAY_MS) {
    dates.push(new Date(ms));
  }

  const rawIds: unknown[] = Array.isArray(body.roomTypeIds) ? body.roomTypeIds : [];
  const roomTypeIds: string[] = [
    ...new Set(rawIds.filter((x): x is string => typeof x === "string")),
  ];

  return { propertyId, dates, roomTypeIds };
}

// Close (Stop Sale) the given dates for the given scope. Idempotent: an already-closed
// date is left closed. roomTypeIds empty = a property-wide closure.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "AVAILABILITY", "update");

    const parsed = await parseBody(request);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { propertyId, dates, roomTypeIds } = parsed;
    await assertPropertyAccess(ctx, propertyId);

    if (roomTypeIds.length > 0) {
      const owned = await prisma.roomType.count({ where: { id: { in: roomTypeIds }, propertyId } });
      if (owned !== roomTypeIds.length) {
        return NextResponse.json({ error: "One or more room types do not belong to this property" }, { status: 400 });
      }
    }

    // scopes: null = property-wide, otherwise each room type id.
    const scopes: (string | null)[] = roomTypeIds.length > 0 ? roomTypeIds : [null];

    // Delete-then-create per (scope, date) keeps exactly one row even though SQLite treats
    // NULL roomTypeId as distinct in the unique index (so a second property-level create
    // wouldn't otherwise be deduped). A duplicate would still just mean "closed", but this
    // keeps the table clean.
    let closed = 0;
    await prisma.$transaction(async (tx) => {
      for (const roomTypeId of scopes) {
        for (const date of dates) {
          await tx.availabilityRestriction.deleteMany({ where: { propertyId, roomTypeId, date } });
          await tx.availabilityRestriction.create({
            data: { propertyId, roomTypeId, date, createdByUserId: ctx.userId },
          });
          closed += 1;
        }
      }
    });

    await logActivity({
      ctx,
      module: "AVAILABILITY",
      action: "UPDATE",
      entityType: "AvailabilityRestriction",
      entityId: propertyId,
      description:
        `Stop Sale (Closed) set for ${dates.length} date(s) — ` +
        (roomTypeIds.length > 0 ? `${roomTypeIds.length} room type(s)` : "property-wide"),
    });

    return NextResponse.json({ closed });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Open (remove Stop Sale) the given dates for the given scope. Idempotent: an
// already-open date is a no-op.
export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "AVAILABILITY", "update");

    const parsed = await parseBody(request);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { propertyId, dates, roomTypeIds } = parsed;
    await assertPropertyAccess(ctx, propertyId);

    const scopeWhere =
      roomTypeIds.length > 0 ? { roomTypeId: { in: roomTypeIds } } : { roomTypeId: null };
    const result = await prisma.availabilityRestriction.deleteMany({
      where: { propertyId, date: { in: dates }, ...scopeWhere },
    });

    await logActivity({
      ctx,
      module: "AVAILABILITY",
      action: "UPDATE",
      entityType: "AvailabilityRestriction",
      entityId: propertyId,
      description:
        `Stop Sale removed (Open) for ${dates.length} date(s) — ` +
        (roomTypeIds.length > 0 ? `${roomTypeIds.length} room type(s)` : "property-wide"),
    });

    return NextResponse.json({ opened: result.count });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
