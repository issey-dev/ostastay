import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toErrorResponse, ForbiddenError, mintSupportSession } from "@/lib/scope";

// Mints the short-lived "acting as Enterprise X" cookie — only callable by the grant's
// own requester, only while it's APPROVED and unexpired. See src/lib/scope.ts for how
// every subsequent request re-verifies this grant is still live.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can enter support access mode");
    }

    const grant = await prisma.supportAccessGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    if (grant.requestedByUserId !== ctx.userId) {
      throw new ForbiddenError("This grant was not requested by you");
    }
    if (grant.status !== "APPROVED") {
      return NextResponse.json({ error: "This grant is not currently approved" }, { status: 400 });
    }
    if (grant.expiresAt && grant.expiresAt <= new Date()) {
      return NextResponse.json({ error: "This grant has expired" }, { status: 400 });
    }

    await mintSupportSession(ctx.userId, grant.enterpriseId, grant.id, grant.expiresAt);

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
