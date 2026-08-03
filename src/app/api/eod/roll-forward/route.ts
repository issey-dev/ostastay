import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { findRollBlockers, validateRollTarget, daysBetween, type RollPreview } from "@/lib/business-date-roll";
import { logActivity } from "@/lib/activity-log";

// Skip the business date forward over days the property was CLOSED, without running an
// End-of-Day for each (app-owner request, 2026-08-03). Night Audit remains the only way
// to close a day that had activity; this exists for days that had none.
//
// GET  ?propertyId=&to=YYYY-MM-DD  — preview: what (if anything) blocks the roll.
// POST { propertyId, to }          — perform it, re-checking every blocker first.
//
// Gated on NIGHT_AUDIT "create", the same permission as running EOD: this moves the same
// date EOD moves, so anyone who may do one may do the other, and nobody else.

function parseTarget(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : toUtcMidnight(d);
}

async function build(propertyId: string, target: Date, current: Date): Promise<RollPreview> {
  const blockers = await findRollBlockers(propertyId, current, target);
  return {
    from: current.toISOString().slice(0, 10),
    to: target.toISOString().slice(0, 10),
    days: daysBetween(current, target),
    blockers,
    canRoll: blockers.length === 0,
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "create");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    const current = resolveBusinessDate(property);

    const target = parseTarget(searchParams.get("to"));
    // No target yet — the UI still needs the current date to seed its picker.
    if (!target) {
      return NextResponse.json({ from: current.toISOString().slice(0, 10), to: null, days: 0, blockers: [], canRoll: false });
    }

    const invalid = validateRollTarget(current, target);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    return NextResponse.json(await build(propertyId, target, current));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "create");

    const body = await request.json().catch(() => null);
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    const current = resolveBusinessDate(property);

    const target = parseTarget(typeof body?.to === "string" ? body.to : null);
    if (!target) return NextResponse.json({ error: "Pick a valid date to roll to." }, { status: 400 });

    const invalid = validateRollTarget(current, target);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    // Re-checked here, not trusted from the preview: the preview may be minutes old and
    // a booking can land in the range in between.
    const preview = await build(propertyId, target, current);
    if (!preview.canRoll) {
      return NextResponse.json(
        { error: "This period still has activity — resolve the items below first.", ...preview },
        { status: 409 }
      );
    }

    // Guarded UPDATE rather than a bare write: `businessDate` in the WHERE means a
    // concurrent EOD (or a second roll) that moved the date first makes this match zero
    // rows instead of overwriting its work.
    const updated = await prisma.property.updateMany({
      where: { id: propertyId, businessDate: property.businessDate },
      data: { businessDate: target },
    });
    if (updated.count === 0) {
      return NextResponse.json(
        { error: "The business date changed while you were reviewing — reload and try again." },
        { status: 409 }
      );
    }

    await logActivity({
      ctx,
      module: "NIGHT_AUDIT",
      action: "RUN",
      entityType: "Property",
      entityId: propertyId,
      description: `Rolled the business date forward ${preview.days} day${preview.days > 1 ? "s" : ""}, ${preview.from} → ${preview.to}, without End-of-Day (closed period)`,
    });

    return NextResponse.json({ ok: true, from: preview.from, to: preview.to, days: preview.days });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
