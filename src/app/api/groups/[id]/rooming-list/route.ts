import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { pickupIntoBlock } from "@/lib/groups/pickup";

// Rooming-list import at the desk (Agent Portal plan Phase 8). CSV with a header row:
//   firstName,lastName,checkIn,checkOut,roomTypeCode,adults,children,email,tentative
// Each line is one pickup through the shared pickup service (same rules as one at a time),
// applied on its own: a bad line is reported, the rest go through.
type Line = Record<string, string>;

function parseCsv(text: string): Line[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  const [head, ...rest] = rows;
  const cols = (head ?? "").split(",").map((c) => c.trim());
  return rest.map((l) => {
    const v = l.split(",").map((x) => x.trim());
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""]));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "GROUP_BLOCKS", "update");
    const { id } = await params;
    const block = await prisma.groupBlock.findUnique({ where: { id }, select: { propertyId: true } });
    if (!block) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await assertPropertyAccess(ctx, block.propertyId);
    const body = await request.json().catch(() => ({}));
    const lines = typeof body?.csv === "string" ? parseCsv(body.csv) : [];
    if (lines.length === 0 || lines.length > 300) return NextResponse.json({ error: "Paste 1 to 300 lines under a header row." }, { status: 400 });
    const types = await prisma.roomType.findMany({ where: { propertyId: block.propertyId }, select: { id: true, code: true } });
    const results = [];
    for (const [i, l] of lines.entries()) {
      const type = types.find((t) => t.code.toLowerCase() === (l.roomTypeCode ?? "").toLowerCase());
      if (!type) {
        results.push({ line: i + 2, ok: false, error: `Unknown room type "${l.roomTypeCode ?? ""}"` });
        continue;
      }
      const r = await pickupIntoBlock(ctx, id, {
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email || null,
        roomTypeId: type.id,
        checkInDate: l.checkIn,
        checkOutDate: l.checkOut,
        adults: Number(l.adults || 1) || 1,
        children: Number(l.children || 0) || 0,
        status: /^(y|yes|true|1)$/i.test(l.tentative ?? "") ? "TENTATIVE" : "RESERVED",
      });
      results.push(r.ok ? { line: i + 2, ok: true, confirmationNo: r.reservation.confirmationNo } : { line: i + 2, ok: false, error: r.error });
    }
    return NextResponse.json({ added: results.filter((r) => r.ok).length, results });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
