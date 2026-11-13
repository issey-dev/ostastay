import { NextResponse } from "next/server";
import { requireSession, toErrorResponse } from "@/lib/scope";

// The signed-in user's own effective access: module actions and capabilities, merged across
// their roles. Lets a screen hide what the server would refuse (e.g. the "Create …" row in a
// profile picker, Agent Portal plan A-21a). Never a security boundary: every action is still
// checked on its own route.
export async function GET() {
  try {
    const ctx = await requireSession();
    const modules: Record<string, { view: boolean; create: boolean; update: boolean; delete: boolean }> = {};
    for (const [m, p] of ctx.permissions) {
      modules[m] = { view: p.canView, create: p.canCreate, update: p.canUpdate, delete: p.canDelete };
    }
    return NextResponse.json(
      { modules, capabilities: [...(ctx.capabilities ?? [])] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
