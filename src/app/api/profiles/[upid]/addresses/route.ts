import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";
import { ADDRESS_TYPES } from "@/lib/profile-communications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const addresses = await prisma.profileAddress.findMany({
      where: { upid },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(addresses);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const body = await request.json();
    if (!body.type || !ADDRESS_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of ${ADDRESS_TYPES.join(", ")}` }, { status: 400 });
    }
    if (!body.fullAddress || !body.fullAddress.trim()) {
      return NextResponse.json({ error: "Full address is required" }, { status: 400 });
    }

    if (body.isPrimary) {
      await prisma.profileAddress.updateMany({ where: { upid }, data: { isPrimary: false } });
    }

    const address = await prisma.profileAddress.create({
      data: {
        upid,
        type: body.type,
        fullAddress: body.fullAddress.trim(),
        city: body.city || null,
        stateProvince: body.stateProvince || null,
        postalCode: body.postalCode || null,
        country: body.country || null,
        isPrimary: !!body.isPrimary,
      },
    });
    return NextResponse.json(address, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
