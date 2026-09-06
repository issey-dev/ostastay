import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { generateWebsiteApiKey } from "@/lib/website-api/key";

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
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdBy: string | null;
  properties: { id: string; name: string }[];
  bookingCount: number;
};

const ROW_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  status: true,
  allowedOrigins: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
  revokedAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  properties: { select: { property: { select: { id: true, name: true } } } },
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
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdBy: r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : null,
    properties: r.properties.map((p) => p.property).sort((a, b) => a.name.localeCompare(b.name)),
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

async function assertPropertiesInEnterprise(enterpriseId: string, propertyIds: string[]): Promise<void> {
  const unique = [...new Set(propertyIds)];
  if (unique.length === 0) throw new ForbiddenError("Choose at least one property");
  const count = await prisma.property.count({ where: { id: { in: unique }, enterpriseId, status: "ACTIVE" } });
  if (count !== unique.length) throw new ForbiddenError("Property not found");
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
  propertyIds: string[];
  allowedOrigins: string[];
  expiresAt: Date | null;
}): Promise<{ key: string; row: WebsiteApiKeyRow }> {
  const name = params.name.trim();
  if (!name) throw new ForbiddenError("A name is required");
  await assertPropertiesInEnterprise(params.enterpriseId, params.propertyIds);
  const origins = normalizeOrigins(params.allowedOrigins);

  const generated = generateWebsiteApiKey();
  const created = await prisma.websiteApiKey.create({
    data: {
      enterpriseId: params.enterpriseId,
      name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      allowedOrigins: origins,
      expiresAt: params.expiresAt,
      createdByUserId: params.userId,
      properties: { create: [...new Set(params.propertyIds)].map((propertyId) => ({ propertyId })) },
    },
    select: ROW_SELECT,
  });
  return { key: generated.key, row: shape(created) };
}

export async function updateWebsiteApiKey(params: {
  enterpriseId: string;
  id: string;
  name?: string;
  propertyIds?: string[];
  allowedOrigins?: string[];
  expiresAt?: Date | null;
}): Promise<WebsiteApiKeyRow> {
  const existing = await findRow(params.enterpriseId, params.id);
  if (!existing) throw new ForbiddenError("API key not found");
  if (existing.status !== "ACTIVE") throw new ForbiddenError("A revoked key cannot be edited");

  const data: {
    name?: string;
    allowedOrigins?: string[];
    expiresAt?: Date | null;
    properties?: { deleteMany: Record<string, never>; create: { propertyId: string }[] };
  } = {};
  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new ForbiddenError("A name is required");
    data.name = name;
  }
  if (params.allowedOrigins !== undefined) data.allowedOrigins = normalizeOrigins(params.allowedOrigins);
  if (params.expiresAt !== undefined) data.expiresAt = params.expiresAt;
  if (params.propertyIds !== undefined) {
    await assertPropertiesInEnterprise(params.enterpriseId, params.propertyIds);
    data.properties = { deleteMany: {}, create: [...new Set(params.propertyIds)].map((propertyId) => ({ propertyId })) };
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
