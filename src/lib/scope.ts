import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setRequestTenantContext } from "@/lib/request-context";
import { getLicenseStatus, isLicenseUsable } from "@/lib/license";
import { MODULES, MODULE_LABELS, HUB_MODULES, moduleScope, type Module, type Action } from "@/lib/modules";
import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS } from "../../prisma/rbac-seed-data";

export { MODULES, HUB_MODULES, type Module, type Action };

import { JWT_SECRET as SUPPORT_JWT_SECRET } from "@/lib/jwt-secret";

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}
// Thrown when the session's working property has rolled its business date under the
// user (End-of-Day finalize). A distinct subclass — and a `code` on the wire — so the
// client can tell "your property closed the day" apart from an ordinary expired
// session and show the EOD notice instead of a generic "please sign in again".
export class EodLockoutError extends UnauthorizedError {
  code = "EOD_ROLL";
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
  // The property this session is actually working in — a PROPERTY user's fixed
  // location, or an ENTERPRISE user's currently-selected one. This is the session's
  // "where", and it's what End-of-Day force-logout is keyed on. Null only when the
  // enterprise has no ACTIVE property at all.
  sessionPropertyId: string | null;
  propertyId: string | null;
  roleId: string;
  permissions: Map<string, PermissionRow>;
  isInternal: boolean; // true when the user's home enterprise is Osta (type INTERNAL)
  isActingAsSupport: boolean;
  supportGrantId?: string;
  // Modules enabled for ctx.enterpriseId — always the full set since 2026-07-31 (see
  // ALL_MODULES_LICENSED); kept as a field so gating has one seam if it ever returns.
  // requirePermission() denies access to anything missing here regardless of role.
  licensedModules: Set<Module>;
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

const ROLE_DEFAULT_MATRICES: Record<string, Record<string, PermissionRow>> = {
  ...SYSTEM_ROLE_DEFS,
  ...SUPPORT_ROLE_DEFS,
};
const NO_ACCESS: PermissionRow = { canView: false, canCreate: false, canUpdate: false, canDelete: false };

type RawRolePermission = { module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean };

// Self-heals a real gap: when a new entry is added to MODULES, an already-seeded
// Role never gets a RolePermission row for it — ensureRoles() in
// prisma/rbac-seed-data.ts only populates permissions the first time a Role is
// created (`update: {}` on its upsert is a true no-op for existing roles). System
// roles compound this, since Controls > Users & Roles blocks editing them entirely
// ("System roles are shared across enterprises and cannot be edited" —
// src/app/api/roles/[id]/route.ts), leaving no self-service way to grant a brand-new
// module. Runs on every requireSession() call but is cheap: a Set diff against the
// small MODULES array, and a DB write only the first time a gap is found — after
// that this is a no-op for the life of the role. Safe under concurrent requests
// racing to backfill the same role, since RolePermission's @@unique([roleId, module])
// plus skipDuplicates makes the insert idempotent.
async function backfillMissingRolePermissions(
  roleId: string,
  roleName: string,
  isSystem: boolean,
  existing: RawRolePermission[]
): Promise<RawRolePermission[]> {
  const existingModules = new Set(existing.map((p) => p.module));
  const missing = MODULES.filter((m) => !existingModules.has(m));
  if (missing.length === 0) return existing;

  // Only System/Support roles have a canonical default defined in code — a custom
  // role an enterprise admin created themselves gets NONE for a new module, exactly
  // like every other module did when that role was first created via the Controls UI.
  const defaults = isSystem ? ROLE_DEFAULT_MATRICES[roleName] : undefined;
  const newRows: RawRolePermission[] = missing.map((module) => ({
    module,
    ...(defaults?.[module] ?? NO_ACCESS),
  }));

  // SQLite doesn't support createMany's skipDuplicates, so backfill via upsert per
  // row instead — still race-safe (RolePermission's @@unique([roleId, module])
  // backs the compound where clause) if two requests hit the same gap concurrently.
  await Promise.all(
    newRows.map((r) =>
      prisma.rolePermission.upsert({
        where: { roleId_module: { roleId, module: r.module } },
        update: {},
        create: { roleId, ...r },
      })
    )
  );

  return [...existing, ...newRows];
}

// CONTROLS and ACTIVITY_LOG are never actually gated by licensing — a locked-out
// enterprise still needs to reach Controls (to understand why) and its own audit trail.
// 2026-07-31 (owner): enterprise-level module gating REMOVED — which modules a tenant
// uses "is not controlled by us." TierModuleAccess and EnterpriseModuleAccess are gone
// from the schema; every module is licensed for every enterprise, and access control is
// the tenant's own role-permission matrix. Osta's levers are the license lifecycle and
// the per-property attribute caps (src/lib/license.ts). ctx.licensedModules is kept as
// a field (requirePermission/hasHubAccess still consult it) so the sellable add-on
// gate (EnterpriseAddonAccess — Spa/Excursions, a separate sellable-add-on mechanism)
// and any future re-introduction have a single seam to plug back into.
const ALL_MODULES_LICENSED: ReadonlySet<Module> = new Set(MODULES);

// The single entry point every route handler must call. Re-fetches the live User row
// (role, enterpriseId, propertyId, isActive) on every request rather than trusting the
// JWT, which carries identity only. If the user is an Osta/INTERNAL user with a live
// "acting as" cookie backed by a still-APPROVED, unexpired SupportAccessGrant, the
// returned enterpriseId is the grant's target — otherwise it's always the user's own.
export async function requireSession(opts?: {
  // Only /api/session/eod-status passes this — it has to stay reachable *after* the
  // lockout in order to tell the client why it's being signed out. Every other caller
  // must take the throw.
  allowDuringEodLockout?: boolean;
}): Promise<AuthContext> {
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

  const rolePermissions = await backfillMissingRolePermissions(
    user.roleId,
    user.role.name,
    user.role.isSystem,
    user.role.permissions
  );

  const permissions = new Map<string, PermissionRow>(
    rolePermissions.map((p) => [
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

  // License lockout — an enterprise whose license is EXPIRED (past grace) or REVOKED
  // loses not just new sign-ins (blocked in /api/auth/login) but LIVE sessions too:
  // every request lands here, so revoking takes effect on the next click, not the next
  // login. Internal (Osta) users are exempt, including when acting as support — support
  // access into a locked-out enterprise is exactly how it gets un-stuck.
  if (!isInternal) {
    const { state: licenseState } = await getLicenseStatus(enterpriseId);
    if (!isLicenseUsable(licenseState)) {
      throw new ForbiddenError(
        licenseState === "REVOKED"
          ? "This enterprise's license has been revoked. Contact Osta to restore access."
          : "This enterprise's license has expired. Contact Osta to renew access."
      );
    }
  }

  // End-of-Day force-logout. Resolved AFTER the support-grant swap above, so a support
  // session is evaluated against the property it's actually acting inside.
  //
  // The rule is location-based, not scope-based: ANY session working in a property that
  // has just rolled its business date is signed out, whether the user is bound to that
  // one property or an enterprise admin who happens to have it selected. Otherwise an
  // enterprise-scoped user keeps a stale business date on screen and carries on posting
  // into a day the property has already closed. `iat` is in seconds.
  const sessionPropertyId = await resolveSessionPropertyId(user.scope, user.propertyId, enterpriseId);
  if (!opts?.allowDuringEodLockout && sessionPropertyId) {
    const prop = await prisma.property.findUnique({
      where: { id: sessionPropertyId },
      select: { eodSessionsInvalidAt: true },
    });
    const iatMs = typeof session?.iat === "number" ? session.iat * 1000 : null;
    if (prop?.eodSessionsInvalidAt && iatMs !== null && iatMs < prop.eodSessionsInvalidAt.getTime()) {
      throw new EodLockoutError(
        "The End-of-Day business date roll has completed for this property. Please sign in again."
      );
    }
  }

  // Every module is licensed for every enterprise since the 2026-07-31 removal of
  // enterprise-level module gating — see ALL_MODULES_LICENSED above.
  const licensedModules = ALL_MODULES_LICENSED as Set<Module>;

  // Tag the rest of this request's async execution with the resolved tenant, so the
  // Prisma operation recorder (src/lib/db.ts) can attribute DB load per
  // enterprise/property on the Osta DB Health dashboard.
  setRequestTenantContext({ enterpriseId, propertyId: sessionPropertyId });

  return {
    userId: user.id,
    enterpriseId,
    homeEnterpriseId: user.enterpriseId,
    scope: user.scope as "ENTERPRISE" | "PROPERTY",
    propertyId: user.propertyId,
    sessionPropertyId,
    roleId: user.roleId,
    permissions,
    isInternal,
    isActingAsSupport,
    supportGrantId,
    licensedModules,
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
  return ctx.sessionPropertyId;
}

// The same resolution, callable from inside requireSession() before an AuthContext
// exists. Deliberately one implementation: the property EOD signs a session out of MUST
// be the property that session was working in, or a user could be locked out of one
// property while looking at another.
async function resolveSessionPropertyId(
  scope: string,
  userPropertyId: string | null,
  enterpriseId: string
): Promise<string | null> {
  if (scope === "PROPERTY") return userPropertyId;

  const cookieStore = await cookies();
  const cookiePropertyId = cookieStore.get(CURRENT_PROPERTY_COOKIE)?.value;
  if (cookiePropertyId) {
    const property = await prisma.property.findUnique({ where: { id: cookiePropertyId } });
    if (property && property.enterpriseId === enterpriseId && property.status === "ACTIVE") return property.id;
  }

  const firstProperty = await prisma.property.findFirst({
    where: { enterpriseId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  return firstProperty?.id ?? null;
}

export async function setCurrentPropertyId(ctx: AuthContext, propertyId: string): Promise<void> {
  if (ctx.scope === "PROPERTY") {
    throw new ForbiddenError("Property-scoped users cannot switch properties");
  }
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.enterpriseId !== ctx.enterpriseId || property.status !== "ACTIVE") {
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
  // Hard gate: a newly-created (PENDING) or Osta-declined (REJECTED) property is fully
  // locked out of real use until approved — see .agents/docs/DECISIONS.md. Osta support
  // acting on an approved SupportAccessGrant is exempted, so troubleshooting a pending
  // property is still possible without needing a separate carve-out mechanism.
  if (property.status !== "ACTIVE" && !ctx.isActingAsSupport) {
    throw new ForbiddenError("This property is pending approval and is not yet active");
  }
}

// Shared guard for every Profile child-resource route (communications, addresses,
// documents, attachments, notes): confirms the profile exists and belongs to the
// caller's enterprise. Profile has no propertyId of its own (enterprise-wide, shared
// across every property) so there's no requirePropertyScope step here.
export async function assertProfileAccess(ctx: AuthContext, upid: string) {
  const profile = await prisma.profile.findUnique({ where: { upid } });
  if (!profile || profile.enterpriseId !== ctx.enterpriseId) {
    throw new ForbiddenError("Profile not found");
  }
  return profile;
}

// The add-on sibling of the `licensedModules` check above — for a module sold as a
// sellable add-on (see EnterpriseAddonAccess in schema.prisma and
// .agents/docs/EXCURSIONS_PLAN.md), a role permission alone isn't enough: the
// enterprise must also have actually purchased/been granted the add-on. Enterprise-
// scoped since 2026-08-02 (owner decision): enabling Spa/Excursions applies to every
// property in the enterprise. The propertyId parameter stays because callers still
// need the property-scoping 403 first — a property that isn't even in the caller's
// enterprise should 403 with "Property not found," not a module-access message that
// leaks its existence. Callers use this ALONGSIDE requirePermission(), never instead
// of it — this checks "is the add-on turned on," requirePermission() checks "is this
// user allowed to use it."
export async function assertPropertyModuleAccess(ctx: AuthContext, propertyId: string, module: Module): Promise<void> {
  await assertPropertyAccess(ctx, propertyId);
  const access = await prisma.enterpriseAddonAccess.findUnique({
    where: { enterpriseId_module: { enterpriseId: ctx.enterpriseId, module } },
  });
  if (!access?.enabled) {
    throw new ForbiddenError(`${MODULE_LABELS[module] ?? module} is not enabled for this enterprise`);
  }
}

// Non-throwing permission probe — same rule as requirePermission (licensing + role CRUD
// flag) but returns a boolean. Use when a route accepts EITHER of two permissions
// (e.g. a Spa catalog readable by both a CONTROLS catalog-manager and a SPA booking user).
export function hasPermission(ctx: AuthContext, module: Module, action: Action): boolean {
  if (!ctx.licensedModules.has(module)) return false;
  const perm = ctx.permissions.get(module);
  if (!perm) return false;
  return action === "view"
    ? perm.canView
    : action === "create"
    ? perm.canCreate
    : action === "update"
    ? perm.canUpdate
    : perm.canDelete;
}

export function requirePermission(ctx: AuthContext, module: Module, action: Action) {
  if (!ctx.licensedModules.has(module)) {
    throw new ForbiddenError(`${module} is not enabled for this enterprise`);
  }

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

// ---------------------------------------------------------------------------
// Hub (enterprise level) — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md
// ---------------------------------------------------------------------------

// The modules that live in the Hub shell (src/app/e/[slug]/hub) rather than the
// property dashboard. The Hub is enterprise-level by definition — connectivity and
// enterprise-wide configuration — and contains NO PMS functionality. Adding a module
// here is what puts it in the Hub; MODULES itself stays a flat list.

// Non-throwing probe — use for navigation/visibility decisions (e.g. whether to show
// the "Hub" link in the property sidebar). requireHubAccess() is the actual gate.
export function hasHubAccess(ctx: AuthContext): boolean {
  // A PROPERTY-scoped user is pinned to a single work location and has no business
  // holding enterprise-wide OTA credentials — blocked outright, regardless of role
  // bits, so granting INTEGRATIONS to a property-scoped user can never open the Hub.
  if (ctx.scope === "PROPERTY") return false;
  return HUB_MODULES.some((m) => hasPermission(ctx, m, "view"));
}

// The single gate every Hub route handler and the Hub layout must call — deliberately
// ONE helper rather than the inline `if (!ctx.isInternal) return 403` pattern the
// /api/osta/** routes repeat file-by-file. That duplication is exactly the shape of
// audit finding S2 (a local guard that silently skipped a step); a Hub-wide rule change
// must be a one-line edit here, not a sweep across every endpoint.
export function requireHubAccess(ctx: AuthContext): void {
  if (ctx.scope === "PROPERTY") {
    throw new ForbiddenError("The Hub is enterprise-level and not available to property-scoped users");
  }
  if (!HUB_MODULES.some((m) => hasPermission(ctx, m, "view"))) {
    throw new ForbiddenError("Not authorized for the Hub");
  }
}

// True when the user has no property-operational access at all — i.e. a Hub-only
// administrator. Such a user must land on the Hub, since every dashboard route would
// bounce them or render an empty shell. See src/app/e/[slug]/dashboard/page.tsx.
export function hasAnyPropertyModule(ctx: AuthContext): boolean {
  return MODULES.some((m) => moduleScope(m) === "PROPERTY" && hasPermission(ctx, m, "view"));
}

// Shared shape for turning a thrown UnauthorizedError/ForbiddenError into a NextResponse
// in a route handler's catch block: `const { status, body } = toErrorResponse(e);`
export function toErrorResponse(e: unknown): { status: number; body: { error: string; code?: string } } {
  if (e instanceof EodLockoutError) {
    return { status: e.status, body: { error: e.message, code: e.code } };
  }
  if (e instanceof UnauthorizedError || e instanceof ForbiddenError) {
    return { status: e.status, body: { error: e.message } };
  }
  console.error(e);
  return { status: 500, body: { error: "Internal server error" } };
}
