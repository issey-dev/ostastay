import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, requireHubAccess, toErrorResponse } from "@/lib/scope";
import { revokeSessionById, TOUCH_INTERVAL_MS } from "@/lib/session-store";
import { logActivity } from "@/lib/activity-log";

// Who is signed in, for how long, and the ability to sign them out.
//
// None of this was possible before 2026-08-04: sessions were stateless JWTs with no
// server-side record, so there was nothing to enumerate and nothing to revoke. See
// src/lib/session-store.ts.

const SESSION_SELECT = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  ipAddress: true,
  userAgent: true,
  propertyId: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      jobFunction: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  },
} as const;

export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "USERS", "view");

    const now = Date.now();
    const sessions = await prisma.session.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        // Enterprise-scoped: an admin sees their own tenant's sessions, never another's.
        user: { enterpriseId: ctx.enterpriseId },
      },
      orderBy: { lastSeenAt: "desc" },
      select: SESSION_SELECT,
    });

    const properties = await prisma.property.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      select: { id: true, name: true, sessionIdleMinutes: true },
    });
    const propertyById = new Map(properties.map((p) => [p.id, p]));

    return NextResponse.json({
      // lastSeenAt is stamped at most once a minute, so "idle for" is accurate to within
      // that. Surfaced so the UI can say so rather than implying second-level precision.
      stampIntervalMs: TOUCH_INTERVAL_MS,
      currentSessionId: ctx.sessionId,
      sessions: sessions.map((s) => ({
        id: s.id,
        userId: s.user.id,
        name: `${s.user.firstName} ${s.user.lastName}`.trim(),
        email: s.user.email,
        roles: s.user.roles.map((ur) => ur.role.name),
        jobFunction: s.user.jobFunction,
        propertyName: s.propertyId ? propertyById.get(s.propertyId)?.name ?? null : null,
        signedInAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        // Uptime and idle time, computed server-side so every viewer agrees regardless of
        // their own clock.
        uptimeMs: now - s.createdAt.getTime(),
        idleMs: now - s.lastSeenAt.getTime(),
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        isCurrent: s.id === ctx.sessionId,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "USERS", "update");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
    }

    // Load it scoped to the caller's enterprise BEFORE revoking, so an id from another
    // tenant reads as not-found rather than being terminated.
    const target = await prisma.session.findFirst({
      where: { id, user: { enterpriseId: ctx.enterpriseId } },
      select: { id: true, user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!target) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const count = await revokeSessionById(id, "ADMIN", ctx.userId);
    if (count === 0) {
      // Already gone — someone else revoked it, or it lapsed between the list and the
      // click. Not an error worth showing; the list just refreshes.
      return NextResponse.json({ success: true, alreadyEnded: true });
    }

    await logActivity({
      ctx,
      module: "USERS",
      action: "UPDATE",
      entityType: "Session",
      entityId: id,
      description:
        `Terminated a session for ${target.user.firstName} ${target.user.lastName} (${target.user.email})` +
        (id === ctx.sessionId ? " — their own" : ""),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
