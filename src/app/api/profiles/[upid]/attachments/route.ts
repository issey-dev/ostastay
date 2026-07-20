import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

// A clickable URL-reference list (label + externally-hosted URL) — deliberately not a
// file-upload/storage system, which doesn't exist anywhere else in this app either.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const attachments = await prisma.profileAttachment.findMany({
      where: { upid },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(attachments);
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
    if (!body.label || !body.label.trim()) {
      return NextResponse.json({ error: "A label is required" }, { status: 400 });
    }
    if (!body.url || !body.url.trim()) {
      return NextResponse.json({ error: "A URL is required" }, { status: 400 });
    }
    try {
      new URL(body.url);
    } catch {
      return NextResponse.json({ error: "Must be a valid URL" }, { status: 400 });
    }

    const attachment = await prisma.profileAttachment.create({
      data: { upid, label: body.label.trim(), url: body.url.trim() },
    });
    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
