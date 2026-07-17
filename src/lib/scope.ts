import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MODULES, type Module, type Action } from "@/lib/modules";

export { MODULES, type Module, type Action };

const SUPPORT_JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_super_secret_jwt_key_that_should_be_changed_in_prod"
);

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}

type PermissionRow = {
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export type AuthContext = {
  userId: string;
  enterpriseId: string; // resolved — home enterprise, or the support-grant target
  homeEnterpriseId: string; // always the user's own enterprise, regardless of support mode
  scope: "ENTERPRISE" | "PROPERTY";
  propertyId: string | null;
  roleId: string;
  permissions: Map<string, PermissionRow>;
  isInternal: boolean; // true when the user's home enterprise is Osta (type INTERNAL)
  isActingAsSupport: boolean;
  supportGrantId?: string;
};

let ostaEnterpriseIdCache: string | null = null;

// Resolves Osta's own enterprise id at runtime rather than a hardcoded constant — avoids
// recreating the DEMO_TENANT_ID anti-pattern this whole feature is closing.
export async function getOstaEnterpriseId(): Promise<string> {
  if (ostaEnterpriseIdCache) return ostaEnterpriseIdCache;
  const osta = await prisma.enterprise.findFirst({ where: { type: "INTERNAL" } });
  if (!osta) {
    throw new Error("No INTERNAL (Osta) enterprise found — seed data is missing or incomplete");
  }
  ostaEnterpriseIdCache = osta.id;
  return osta.id;
}

type SupportSessionPayload = {
  actingUserId: string;
  targetEnterpriseId: string;
  grantId: string;
};

async function readSupportSession(): Promise<SupportSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("support_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SUPPORT_JWT_SECRET);
    if (
      typeof payload.actingUserId === "string" &&
      typeof payload.targetEnterpriseId === "string" &&
      typeof payload.grantId === "string"
    ) {
      return payload as unknown as SupportSessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// Mints the short-lived "acting as Enterprise X" cookie once a SupportAccessGrant is
// APPROVED. Capped at 2h regardless of the grant's own expiry, so a long-lived grant
// still requires periodically re-entering support mode rather than silently running
// forever in one browser tab.
export async function mintSupportSession(
  actingUserId: string,
  targetEnterpriseId: string,
  grantId: string,
  grantExpiresAt: Date | null
) {
  const twoHours = Date.now() + 2 * 60 * 60 * 1000;
  const expMs = grantExpiresAt ? Math.min(grantExpiresAt.getTime(), twoHours) : twoHours;

  const token = await new SignJWT({ actingUserId, targetEnterpriseId, grantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expMs / 1000))
    .sign(SUPPORT_JWT_SECRET);

  const cookieStore = await cookies();
  cookieStore.set("support_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expMs),
  });
}

export async function clearSupportSession() {
  const cookieStore = await cookies();
  cookieStore.delete("support_session");
}

// The single entry point every route handler must call. Re-fetches the live User row
// (role, enterpriseId, propertyId, isActive) on every request rather than trusting the
// JWT, which carries identity only. If the user is an Osta/INTERNAL user with a live
// "acting as" cookie backed by a still-APPROVED, unexpired SupportAccessGrant, the
// returned enterpriseId is the grant's target — otherwise it's always the user's own.
export async function requireSession(): Promise<AuthContext> {
  const session = await getSession();
  const userId = session?.id;
  if (!userId || typeof userId !== "string") {
    throw new UnauthorizedError("Not authenticated");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: true } } },
  });
  if (!user || !user.isActive) {
    throw new UnauthorizedError("Session invalid or account disabled");
  }

  const ostaEnterpriseId = await getOstaEnterpriseId();
  const isInternal = user.enterpriseId === ostaEnterpriseId;

  const permissions = new Map<string, PermissionRow>(
    user.role.permissions.map((p) => [
      p.module,
      { canView: p.canView, canCreate: p.canCreate, canUpdate: p.canUpdate, canDelete: p.canDelete },
    ])
  );

  let enterpriseId = user.enterpriseId;
  let isActingAsSupport = false;
  let supportGrantId: string | undefined;

  if (isInternal) {
    const support = await readSupportSession();
    if (support && support.actingUserId === user.id) {
      const grant = await prisma.supportAccessGrant.findUnique({ where: { id: support.grantId } });
      const isLive =
        !!grant &&
        grant.status === "APPROVED" &&
        grant.requestedByUserId === user.id &&
        grant.enterpriseId === support.targetEnterpriseId &&
        (!grant.expiresAt || grant.expiresAt > new Date());

      if (!isLive) {
        await clearSupportSession();
        throw new ForbiddenError("Support access grant is no longer active");
      }

      enterpriseId = grant!.enterpriseId;
      isActingAsSupport = true;
      supportGrantId = grant!.id;
    }
  }

  return {
    userId: user.id,
    enterpriseId,
    homeEnterpriseId: user.enterpriseId,
    scope: user.scope as "ENTERPRISE" | "PROPERTY",
    propertyId: user.propertyId,
    roleId: user.roleId,
    permissions,
    isInternal,
    isActingAsSupport,
    supportGrantId,
  };
}

// Convenience for routes that only need the scoped enterprise id — never accept an
// enterpriseId from a query param or request body, always derive it from here.
export async function requireEnterpriseId(): Promise<string> {
  const ctx = await requireSession();
  return ctx.enterpriseId;
}

// For PROPERTY-scoped users, rejects any property other than their single work
// location. ENTERPRISE-scoped users pass through (the caller is still responsible for
// confirming the property belongs to ctx.enterpriseId).
export function requirePropertyScope(ctx: AuthContext, propertyId: string) {
  if (ctx.scope === "PROPERTY" && ctx.propertyId !== propertyId) {
    throw new ForbiddenError("Not authorized for this property");
  }
}

const CURRENT_PROPERTY_COOKIE = "current_property_id";

// For an ENTERPRISE-scoped user, the "currently working" property is a plain UX
// preference persisted in a cookie (not a security boundary — requirePropertyScope()
// is what actually gates access). For a PROPERTY-scoped user it's always their single
// fixed work location, never the cookie.
export async function resolveCurrentPropertyId(ctx: AuthContext): Promise<string | null> {
  if (ctx.scope === "PROPERTY") return ctx.propertyId;

  const cookieStore = await cookies();
  const cookiePropertyId = cookieStore.get(CURRENT_PROPERTY_COOKIE)?.value;
  if (cookiePropertyId) {
    const property = await prisma.property.findUnique({ where: { id: cookiePropertyId } });
    if (property && property.enterpriseId === ctx.enterpriseId) return property.id;
  }

  const firstProperty = await prisma.property.findFirst({
    where: { enterpriseId: ctx.enterpriseId },
    orderBy: { createdAt: "asc" },
  });
  return firstProperty?.id ?? null;
}

export async function setCurrentPropertyId(ctx: AuthContext, propertyId: string): Promise<void> {
  if (ctx.scope === "PROPERTY") {
    throw new ForbiddenError("Property-scoped users cannot switch properties");
  }
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.enterpriseId !== ctx.enterpriseId) {
    throw new ForbiddenError("Property not found");
  }
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_PROPERTY_COOKIE, propertyId, {
    httpOnly: false, // read client-side by property-provider.tsx for instant UI feedback
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

// Shared guard for every Property-scoped reference/config resource (buildings, floors,
// room types, rooms, rate plans, facilities, ...): confirms the property exists, belongs
// to the caller's enterprise, and — for a PROPERTY-scoped user — is their own work
// location. One generic "Property not found" message either way, so a probing request
// can't distinguish "wrong enterprise" from "doesn't exist".
export async function assertPropertyAccess(ctx: AuthContext, propertyId: string): Promise<void> {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.enterpriseId !== ctx.enterpriseId) {
    throw new ForbiddenError("Property not found");
  }
  requirePropertyScope(ctx, propertyId);
}

export function requirePermission(ctx: AuthContext, module: Module, action: Action) {
  const perm = ctx.permissions.get(module);
  const allowed =
    !!perm &&
    (action === "view"
      ? perm.canView
      : action === "create"
      ? perm.canCreate
      : action === "update"
      ? perm.canUpdate
      : perm.canDelete);

  if (!allowed) {
    throw new ForbiddenError(`Missing ${action} permission on ${module}`);
  }
}

// Scaffold only — fails OPEN (allows) when no TierModuleAccess row matches, since the
// real Standard/Pro/Max feature split hasn't been defined yet. Do not treat a `true`
// result here as proof the module is actually licensed; it just means nothing has
// explicitly disabled it yet.
export async function requireModuleLicensed(enterpriseId: string, module: Module): Promise<void> {
  const license = await prisma.enterpriseLicense.findUnique({ where: { enterpriseId } });
  const tier = license?.tier ?? "STANDARD";
  const row = await prisma.tierModuleAccess.findUnique({
    where: { tier_module: { tier, module } },
  });
  const enabled = row ? row.enabled : true;
  if (!enabled) {
    throw new ForbiddenError(`${module} is not included in the ${tier} plan`);
  }
}

// Shared shape for turning a thrown UnauthorizedError/ForbiddenError into a NextResponse
// in a route handler's catch block: `const { status, body } = toErrorResponse(e);`
export function toErrorResponse(e: unknown): { status: number; body: { error: string } } {
  if (e instanceof UnauthorizedError || e instanceof ForbiddenError) {
    return { status: e.status, body: { error: e.message } };
  }
  console.error(e);
  return { status: 500, body: { error: "Internal server error" } };
}
