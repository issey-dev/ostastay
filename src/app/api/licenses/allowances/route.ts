import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { getPropertyLicenseUsage } from "@/lib/license";
import { logActivity } from "@/lib/activity-log";

// Per-property license allowances (owner decision 2026-07-31: room-type/room/channel
// caps are per property, not enterprise totals). Read: Osta, or an enterprise viewing
// its own numbers. Write: Osta only. Null cap = unlimited; 0 = disallowed. Usage counts
// exclude pseudo (PM) room types and their rooms by definition.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const requestedEnterpriseId = searchParams.get("enterpriseId") ?? ctx.enterpriseId;

    if (!ctx.isInternal && requestedEnterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Not authorized for this enterprise's license");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const properties = await prisma.property.findMany({
      where: { enterpriseId: requestedEnterpriseId },
      select: { id: true, name: true, code: true, status: true, licenseAllowance: true },
      orderBy: { name: "asc" },
    });

    const rows = await Promise.all(
      properties.map(async (p) => ({
        propertyId: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        allowance: p.licenseAllowance
          ? {
              maxRoomTypes: p.licenseAllowance.maxRoomTypes,
              maxRooms: p.licenseAllowance.maxRooms,
              maxChannels: p.licenseAllowance.maxChannels,
            }
          : null,
        usage: await getPropertyLicenseUsage(p.id),
      }))
    );

    return NextResponse.json(rows);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

function parseCap(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = parseInt(String(v));
  return isNaN(n) || n < 0 ? undefined : n;
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can change license allowances");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    const property = await prisma.property.findUnique({
      where: { id: body.propertyId },
      select: { id: true, name: true, enterprise: { select: { name: true } } },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const maxRoomTypes = parseCap(body.maxRoomTypes);
    const maxRooms = parseCap(body.maxRooms);
    const maxChannels = parseCap(body.maxChannels);

    const allowance = await prisma.propertyLicenseAllowance.upsert({
      where: { propertyId: property.id },
      update: { maxRoomTypes, maxRooms, maxChannels },
      create: {
        propertyId: property.id,
        maxRoomTypes: maxRoomTypes ?? null,
        maxRooms: maxRooms ?? null,
        maxChannels: maxChannels ?? null,
      },
    });

    const fmt = (n: number | null) => (n === null ? "unlimited" : String(n));
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "PropertyLicenseAllowance",
      entityId: allowance.id,
      description: `Set license allowances for "${property.name}" (${property.enterprise.name}) — room types ${fmt(allowance.maxRoomTypes)}, rooms ${fmt(allowance.maxRooms)}, channels ${fmt(allowance.maxChannels)}`,
    });

    return NextResponse.json({
      ...allowance,
      usage: await getPropertyLicenseUsage(property.id),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
