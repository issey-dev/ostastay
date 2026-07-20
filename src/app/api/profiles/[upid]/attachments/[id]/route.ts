import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ upid: string; id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid, id } = await params;
    await assertProfileAccess(ctx, upid);

    const existing = await prisma.profileAttachment.findUnique({ where: { id } });
    if (!existing || existing.upid !== upid) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    await prisma.profileAttachment.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
