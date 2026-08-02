import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

// Read-only — UserActivityLog rows are written exclusively by src/lib/activity-log.ts
// from inside the mutating routes themselves; there is deliberately no POST/PUT/DELETE
// here (an editable audit trail isn't an audit trail).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "ACTIVITY_LOG", "view");

    const { searchParams } = new URL(request.url);
    const moduleParam = searchParams.get("module");
    const action = searchParams.get("action");
    const userId = searchParams.get("userId");
    const q = searchParams.get("q");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

    const where = {
      enterpriseId: ctx.enterpriseId,
      ...(moduleParam ? { module: moduleParam } : {}),
      ...(action ? { action } : {}),
      ...(userId ? { userId } : {}),
      ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lt: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [entries, total] = await Promise.all([
      prisma.userActivityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.userActivityLog.count({ where }),
    ]);

    return NextResponse.json({ entries, total, limit, offset });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
