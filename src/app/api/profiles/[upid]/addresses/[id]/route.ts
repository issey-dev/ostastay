import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";
import { ADDRESS_TYPES } from "@/lib/profile-communications";

async function loadOwnRow(upid: string, id: string) {
  const row = await prisma.profileAddress.findUnique({ where: { id } });
  if (!row || row.upid !== upid) return null;
  return row;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ upid: string; id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid, id } = await params;
    await assertProfileAccess(ctx, upid);

    const existing = await loadOwnRow(upid, id);
    if (!existing) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    const body = await request.json();
    const type = body.type ?? existing.type;
    if (!ADDRESS_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${ADDRESS_TYPES.join(", ")}` }, { status: 400 });
    }
    const fullAddress = body.fullAddress !== undefined ? body.fullAddress : existing.fullAddress;
    if (!fullAddress || !String(fullAddress).trim()) {
      return NextResponse.json({ error: "Full address is required" }, { status: 400 });
    }

    const makingPrimary = body.isPrimary === true && !existing.isPrimary;
    if (makingPrimary) {
      await prisma.profileAddress.updateMany({ where: { upid }, data: { isPrimary: false } });
    }

    const updated = await prisma.profileAddress.update({
      where: { id },
      data: {
        type,
        fullAddress: String(fullAddress).trim(),
        city: body.city !== undefined ? body.city : existing.city,
        stateProvince: body.stateProvince !== undefined ? body.stateProvince : existing.stateProvince,
        postalCode: body.postalCode !== undefined ? body.postalCode : existing.postalCode,
        country: body.country !== undefined ? body.country : existing.country,
        isPrimary: body.isPrimary !== undefined ? !!body.isPrimary : existing.isPrimary,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ upid: string; id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid, id } = await params;
    await assertProfileAccess(ctx, upid);

    const existing = await loadOwnRow(upid, id);
    if (!existing) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    await prisma.profileAddress.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
