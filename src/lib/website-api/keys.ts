import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { generateWebsiteApiKey } from "@/lib/website-api/key";
import { normalizeScopes, type ApiScope } from "@/lib/website-api/scopes";

// Hub-side management of Website API keys — list, mint, edit, rotate, revoke. Every
// function takes the enterpriseId from the caller's session (never from the client) and
// refuses to touch a key or property belonging to another enterprise with the same
// generic "not found" a probe would get for a random id.

export type WebsiteApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  /** ACTIVE but past expiresAt — computed here so the UI never reads the clock in render. */
  isExpired: boolean;
  allowedOrigins: string[];
  /** ROOMS | EXCURSIONS | SPA. */
  scopes: ApiScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdBy: string | null;
  /** The one property the key covers; null = ALL the enterprise's properties. */
  property: { id: string; name: string } | null;
  bookingCount: number;
};

const ROW_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  status: true,
  allowedOrigins: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
  revokedAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  property: { select: { id: true, name: true } },
  _count: { select: { bookings: { where: { status: "CONFIRMED" } } } },
} as const;

type RawRow = NonNullable<Awaited<ReturnType<typeof findRow>>>;

function findRow(enterpriseId: string, id: string) {
  return prisma.websiteApiKey.findFirst({ where: { id, enterpriseId }, select: ROW_SELECT });
}

function shape(r: RawRow): WebsiteApiKeyRow {
  return {
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    status: r.status,
    isExpired: r.status === "ACTIVE" && !!r.expiresAt && r.expiresAt.getTime() < Date.now(),
    allowedOrigins: r.allowedOrigins,
    scopes: r.scopes as ApiScope[],
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdBy: r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : null,
    property: r.property,
    bookingCount: r._count.bookings,
  };
}

/**
 * Normalise an origin allow-list: each entry must be a valid absolute URL, and only its
 * origin (scheme + host + port) is kept — a pasted page URL becomes its site's origin.
 * Throws on anything that is not a URL so the Hub form can show the offending entry.
 */
export function normalizeOrigins(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const v = raw.trim();
    if (!v) continue;
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new ForbiddenError(`"${v}" is not a valid origin (expected e.g. https://www.example.com)`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ForbiddenError(`"${v}" must use http or https`);
    }
    out.add(url.origin);
  }
  return [...out];
}

// A key covers one property or ALL (null) — never a subset. A named property must be one
// of this enterprise's ACTIVE properties.
async function assertPropertyInEnterprise(enterpriseId: string, propertyId: string | null): Promise<void> {
  if (propertyId === null) return;
  const count = await prisma.property.count({ where: { id: propertyId, enterpriseId, status: "ACTIVE" } });
  if (count !== 1) throw new ForbiddenError("Property not found");
}

/** "Veyo Beach Resort" / "all properties" — for activity-log lines. */
export function keyCoverage(row: Pick<WebsiteApiKeyRow, "property">): string {
  return row.property?.name ?? "all properties";
}

export async function listWebsiteApiKeys(enterpriseId: string): Promise<WebsiteApiKeyRow[]> {
  const rows = await prisma.websiteApiKey.findMany({
    where: { enterpriseId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: ROW_SELECT,
  });
  return rows.map(shape);
}

export async function createWebsiteApiKey(params: {
  enterpriseId: string;
  userId: string;
  name: string;
  /** One property, or null for ALL the enterprise's properties. */
  propertyId: string | null;
  allowedOrigins: string[];
  /** Defaults to ROOMS — a key minted without a choice is a rooms key, as before scopes. */
  scopes?: string[];
  expiresAt: Date | null;
}): Promise<{ key: string; row: WebsiteApiKeyRow }> {
  const name = params.name.trim();
  if (!name) throw new ForbiddenError("A name is required");
  await assertPropertyInEnterprise(params.enterpriseId, params.propertyId);
  const origins = normalizeOrigins(params.allowedOrigins);
  const scopes = await normalizeScopes(params.enterpriseId, params.scopes ?? ["ROOMS"]);

  const generated = generateWebsiteApiKey();
  const created = await prisma.websiteApiKey.create({
    data: {
      enterpriseId: params.enterpriseId,
      name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      allowedOrigins: origins,
      scopes,
      expiresAt: params.expiresAt,
      createdByUserId: params.userId,
      propertyId: params.propertyId,
    },
    select: ROW_SELECT,
  });
  return { key: generated.key, row: shape(created) };
}

export async function updateWebsiteApiKey(params: {
  enterpriseId: string;
  id: string;
  name?: string;
  /** One property, or null for ALL; undefined leaves it as it is. */
  propertyId?: string | null;
  allowedOrigins?: string[];
  scopes?: string[];
  expiresAt?: Date | null;
}): Promise<WebsiteApiKeyRow> {
  const existing = await findRow(params.enterpriseId, params.id);
  if (!existing) throw new ForbiddenError("API key not found");
  if (existing.status !== "ACTIVE") throw new ForbiddenError("A revoked key cannot be edited");

  const data: {
    name?: string;
    allowedOrigins?: string[];
    scopes?: ApiScope[];
    expiresAt?: Date | null;
    propertyId?: string | null;
  } = {};
  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new ForbiddenError("A name is required");
    data.name = name;
  }
  if (params.allowedOrigins !== undefined) data.allowedOrigins = normalizeOrigins(params.allowedOrigins);
  if (params.expiresAt !== undefined) data.expiresAt = params.expiresAt;
  if (params.scopes !== undefined) {
    // A scope the key already holds stays allowed even if its add-on was since switched
    // off (the API refuses it live anyway); only NEWLY added add-on scopes need the add-on.
    const kept = params.scopes.filter((s) => existing.scopes.includes(s));
    const added = params.scopes.filter((s) => !existing.scopes.includes(s));
    const validatedAdded = added.length ? await normalizeScopes(params.enterpriseId, added) : [];
    const all = [...new Set([...kept, ...validatedAdded])];
    if (all.length === 0) throw new ForbiddenError("Choose at least one thing this key may use");
    data.scopes = (["ROOMS", "EXCURSIONS", "SPA"] as ApiScope[]).filter((s) => all.includes(s));
  }
  if (params.propertyId !== undefined) {
    await assertPropertyInEnterprise(params.enterpriseId, params.propertyId);
    data.propertyId = params.propertyId;
  }

  const updated = await prisma.websiteApiKey.update({ where: { id: params.id }, data, select: ROW_SELECT });
  return shape(updated);
}

/**
 * Rotation: the SAME row gets a new hash, so its name, properties, origins and booking
 * history stay attached. The old plaintext stops working the moment this commits — the
 * website must be updated promptly. Mirrors the webhook URL "regenerate" in
 * src/app/api/osta/channels/connections/[id]/webhook/route.ts.
 */
export async function rotateWebsiteApiKey(params: { enterpriseId: string; id: string }): Promise<{ key: string; row: WebsiteApiKeyRow }> {
  const existing = await findRow(params.enterpriseId, params.id);
  if (!existing) throw new ForbiddenError("API key not found");
  if (existing.status !== "ACTIVE") throw new ForbiddenError("A revoked key cannot be rotated — create a new one");

  const generated = generateWebsiteApiKey();
  const updated = await prisma.websiteApiKey.update({
    where: { id: params.id },
    data: { keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, lastUsedAt: null },
    select: ROW_SELECT,
  });
  return { key: generated.key, row: shape(updated) };
}

/** Revocation is permanent and keeps the row (and its bookings) for the audit trail. */
export async function revokeWebsiteApiKey(params: { enterpriseId: string; id: string; userId: string }): Promise<WebsiteApiKeyRow> {
  const existing = await findRow(params.enterpriseId, params.id);
  if (!existing) throw new ForbiddenError("API key not found");
  if (existing.status === "REVOKED") return shape(existing);

  const updated = await prisma.websiteApiKey.update({
    where: { id: params.id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: params.userId },
    select: ROW_SELECT,
  });
  return shape(updated);
}
