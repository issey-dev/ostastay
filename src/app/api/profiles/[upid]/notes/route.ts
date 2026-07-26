import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

// A running, dated log for feedback/complaints/notable guest-specific things — see
// .agents/docs/PROFILES_REDESIGN_PLAN.md. authorUserId always comes from the session,
// never the client. Pinned notes surface first.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);
    requirePermission(ctx, "PROFILES", "view");

    const notes = await prisma.profileNote.findMany({
      where: { upid },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    });
    const authorIds = [...new Set(notes.map((n) => n.authorUserId))];
    const authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

    return NextResponse.json(notes.map((n) => ({ ...n, authorName: authorMap.get(n.authorUserId) ?? "Unknown" })));
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
    if (!body.noteText || !body.noteText.trim()) {
      return NextResponse.json({ error: "Note text is required" }, { status: 400 });
    }

    const note = await prisma.profileNote.create({
      data: {
        upid,
        authorUserId: ctx.userId,
        noteText: body.noteText.trim(),
        isPinned: !!body.isPinned,
      },
    });
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
