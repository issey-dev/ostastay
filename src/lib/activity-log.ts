import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";

// The ONE way a UserActivityLog row is ever written. Call it after a mutating
// action succeeds (views are deliberately never logged). Logging must never break
// the action it describes — every failure is swallowed to console.error — but the
// write is awaited so callers (and tests) can rely on the row existing once the
// response is returned.
//
// User identity is snapshotted (email/name copied at write time), so the trail
// survives renames and deletions, and support-mode actions are stamped isSupport
// with the acting Osta user's identity while landing in the TARGET enterprise's
// trail — the enterprise being acted on is the one whose auditors need to see it.

type LogInput = {
  ctx: AuthContext;
  module: string; // RBAC module name
  action: string; // CREATE | UPDATE | DELETE | CHECK_IN | VOID | RUN | ...
  description: string; // human-readable, e.g. `Voided charge "Minibar" ($50.00)`
  entityType?: string; // e.g. "Reservation"
  entityId?: string;
  metadata?: unknown; // JSON-serialized if present
};

export async function logActivity(input: LogInput): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.ctx.userId },
      select: { email: true, firstName: true, lastName: true },
    });
    await prisma.userActivityLog.create({
      data: {
        enterpriseId: input.ctx.enterpriseId,
        userId: input.ctx.userId,
        userEmail: user?.email ?? null,
        userName: user ? `${user.firstName} ${user.lastName}` : null,
        isSupport: input.ctx.isActingAsSupport,
        module: input.module,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        description: input.description,
        metadata: input.metadata !== undefined ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (e) {
    console.error("Failed to write activity log (action itself succeeded):", e);
  }
}

// Auth events happen outside a session context (login has no ctx yet; a failed
// login may not even resolve to a user), so they get their own entry point.
export async function logAuthActivity(input: {
  action: "LOGIN" | "LOGIN_FAILED" | "LOGOUT";
  email: string;
  userId?: string | null;
  userName?: string | null;
  enterpriseId?: string | null;
  description: string;
}): Promise<void> {
  try {
    await prisma.userActivityLog.create({
      data: {
        enterpriseId: input.enterpriseId ?? null,
        userId: input.userId ?? null,
        userEmail: input.email,
        userName: input.userName ?? null,
        module: "AUTH",
        action: input.action,
        description: input.description,
      },
    });
  } catch (e) {
    console.error("Failed to write auth activity log:", e);
  }
}
