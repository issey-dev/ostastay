import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

async function loadOwnRow(upid: string, id: string) {
  const row = await prisma.profileNote.findUnique({ where: { id } });
  if (!row || row.upid !== upid) return null;
  return row;
}

// Only the note's own author (or an admin-level update permission) may edit its text;
// anyone with PROFILES.update can toggle the pin — matches how the rest of this app's
// per-row edits stay simple rather than adding a bespoke ownership model.
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
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const body = await request.json();
    const noteText = body.noteText !== undefined ? body.noteText : existing.noteText;
    if (!noteText || !String(noteText).trim()) {
      return NextResponse.json({ error: "Note text is required" }, { status: 400 });
    }

    const updated = await prisma.profileNote.update({
      where: { id },
      data: {
        noteText: String(noteText).trim(),
        isPinned: body.isPinned !== undefined ? !!body.isPinned : existing.isPinned,
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
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    await prisma.profileNote.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
