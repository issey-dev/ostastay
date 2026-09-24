import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { deflateSync } from "zlib";

// A property's uploaded logo (owner, 2026-09-24 — src/lib/property-logo.ts): the browser
// crops to 3:2 and exports 900 × 600 PNG; the server verifies, stores and serves it, and the
// logo reaches emails and the Booking API as an absolute URL.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { validateLogo, pngSize, absoluteLogoUrl, LogoValidationError } = await import("@/lib/property-logo");
const { loadEmailBranding } = await import("@/lib/document-settings");
const logoRoute = await import("@/app/api/properties/[id]/logo/route");
const serveRoute = await import("@/app/api/logos/[file]/route");
const propertyRoute = await import("@/app/api/properties/[id]/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** A real (tiny-content) PNG of the given size — what the browser cropper exports. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height); // fully transparent
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const upload = (userId: string, propertyId: string, file: Buffer) =>
  asUser(userId, () => {
    const form = new FormData();
    form.append("logo", new Blob([new Uint8Array(file)], { type: "image/png" }), "logo.png");
    return logoRoute.POST(new Request(`http://localhost/api/properties/${propertyId}/logo`, { method: "POST", body: form }), { params: Promise.resolve({ id: propertyId }) });
  });
const serve = (url: string) => {
  const file = url.split("/").pop()!;
  return serveRoute.GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ file }) });
};

describe("logo checks (pure)", () => {
  it("accepts only a 900 × 600 PNG", () => {
    expect(pngSize(png(900, 600))).toEqual({ width: 900, height: 600 });
    expect(() => validateLogo(png(900, 600))).not.toThrow();
    expect(() => validateLogo(png(600, 600))).toThrow(LogoValidationError);
    expect(() => validateLogo(Buffer.from("GIF89a not a png"))).toThrow(LogoValidationError);
    expect(() => validateLogo(Buffer.alloc(0))).toThrow(LogoValidationError);
  });

  it("makes our stored path absolute, leaves an external URL alone", () => {
    const before = process.env.APP_URL;
    process.env.APP_URL = "https://stay.example.com/";
    try {
      expect(absoluteLogoUrl("/api/logos/x.png")).toBe("https://stay.example.com/api/logos/x.png");
      expect(absoluteLogoUrl("https://cdn.example.com/l.png")).toBe("https://cdn.example.com/l.png");
      expect(absoluteLogoUrl(null)).toBeNull();
    } finally {
      process.env.APP_URL = before;
    }
  });
});

describe("uploading a property logo", () => {
  let adminId: string;
  let propertyId: string;
  let otherAdminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);
    const mk = async (name: string) => {
      const ent = await prisma.enterprise.create({ data: { name, slug: `test-logo-${uniq()}`, type: "STANDARD" } });
      const prop = await prisma.property.create({
        data: { enterpriseId: ent.id, name: `${name} Resort`, code: `LG-${uniq()}`, legalName: "L LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      });
      const user = await prisma.user.create({
        data: { enterpriseId: ent.id, email: `logo-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      });
      return { propertyId: prop.id, userId: user.id };
    };
    ({ propertyId, userId: adminId } = await mk("Logo"));
    ({ userId: otherAdminId } = await mk("Other"));
  });

  it("stores the logo, serves it cached for good, replaces and removes it", async () => {
    const res = await upload(adminId, propertyId, png(900, 600));
    expect(res.status).toBe(200);
    const { logoUrl } = await res.json();
    expect(logoUrl).toMatch(/^\/api\/logos\/[a-zA-Z0-9-]+\.png$/);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).logoUrl).toBe(logoUrl);

    const served = await serve(logoUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");

    // A new upload gets a new URL, and the old file is gone.
    const second = await (await upload(adminId, propertyId, png(900, 600))).json();
    expect(second.logoUrl).not.toBe(logoUrl);
    expect((await serve(logoUrl)).status).toBe(404);

    // The profile form's save can no longer change it.
    await asUser(adminId, () =>
      propertyRoute.PUT(
        new Request(`http://localhost/api/properties/${propertyId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ logoUrl: "https://evil.example/x.png" }) }),
        { params: Promise.resolve({ id: propertyId }) }
      )
    );
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).logoUrl).toBe(second.logoUrl);

    // Emails get it absolute.
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    const email = await loadEmailBranding(property);
    expect(email.settings.invoiceLogoUrl).toMatch(/^https?:\/\/.+\/api\/logos\//);

    const removed = await asUser(adminId, () => logoRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: propertyId }) }));
    expect(removed.status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).logoUrl).toBeNull();
    expect((await serve(second.logoUrl)).status).toBe(404);
  });

  it("refuses a file the cropper didn't make, and another enterprise's property", async () => {
    expect((await upload(adminId, propertyId, png(1200, 1200))).status).toBe(400);
    expect((await upload(adminId, propertyId, Buffer.from("<svg/>"))).status).toBe(400);
    expect((await upload(otherAdminId, propertyId, png(900, 600))).status).toBe(403);
  });

  it("never serves a path outside the logo store", async () => {
    const res = await serveRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ file: "..%2F..%2F.env" }) });
    expect(res.status).toBe(404);
  });
});
