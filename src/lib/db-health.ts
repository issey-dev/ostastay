import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";

// Row counts for a fixed, hand-picked list of the heaviest/most operationally
// relevant tables — not every model in the schema (that would be noise, not signal).
export async function getRowCounts(): Promise<Record<string, number>> {
  const [enterprises, properties, users, profiles, reservations, folios, priceCalendarRows] = await Promise.all([
    prisma.enterprise.count(),
    prisma.property.count(),
    prisma.user.count(),
    prisma.profile.count(),
    prisma.reservation.count(),
    prisma.folio.count(),
    prisma.priceCalendar.count(),
  ]);
  return { enterprises, properties, users, profiles, reservations, folios, priceCalendarRows };
}

// Compares the migrations directory on disk against the `_prisma_migrations` table —
// no shelling out to `prisma migrate status` from within a running Next.js process.
export async function getMigrationStatus(): Promise<{ appliedCount: number; onDiskCount: number; inSync: boolean; lastApplied: string | null }> {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  let onDisk: string[] = [];
  try {
    onDisk = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    onDisk = [];
  }

  let applied: Array<{ migration_name: string }> = [];
  try {
    applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at ASC`
    );
  } catch {
    applied = [];
  }

  return {
    appliedCount: applied.length,
    onDiskCount: onDisk.length,
    inSync: applied.length === onDisk.length,
    lastApplied: applied.length > 0 ? applied[applied.length - 1].migration_name : null,
  };
}

// SQLite-level storage breakdown. Page accounting comes from PRAGMAs (always
// available); the per-table byte split needs the dbstat virtual table, which is a
// compile-time option of the bundled SQLite — so it's probed and reported as null when
// absent rather than assumed. All raw SQL here is read-only.
export type StorageStats = {
  pageSize: number | null;
  pageCount: number | null;
  freelistCount: number | null; // reclaimable pages (VACUUM would release these)
  totalBytes: number | null; // pageCount * pageSize
  freeBytes: number | null; // freelistCount * pageSize
  tables: Array<{ name: string; bytes: number; percent: number }> | null; // null = dbstat unavailable
};

export async function getStorageStats(): Promise<StorageStats> {
  let pageSize: number | null = null;
  let pageCount: number | null = null;
  let freelistCount: number | null = null;
  try {
    const [ps] = await prisma.$queryRawUnsafe<Array<{ page_size: number | bigint }>>(`PRAGMA page_size`);
    const [pc] = await prisma.$queryRawUnsafe<Array<{ page_count: number | bigint }>>(`PRAGMA page_count`);
    const [fl] = await prisma.$queryRawUnsafe<Array<{ freelist_count: number | bigint }>>(`PRAGMA freelist_count`);
    pageSize = ps ? Number(ps.page_size) : null;
    pageCount = pc ? Number(pc.page_count) : null;
    freelistCount = fl ? Number(fl.freelist_count) : null;
  } catch {
    // non-SQLite or PRAGMA blocked — leave everything null
  }

  let tables: StorageStats["tables"] = null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; bytes: number | bigint }>>(
      `SELECT name, SUM(pgsize) AS bytes FROM dbstat WHERE name NOT LIKE 'sqlite_%' GROUP BY name ORDER BY bytes DESC LIMIT 30`
    );
    const total = rows.reduce((s, r) => s + Number(r.bytes), 0);
    tables = rows.map((r) => ({
      name: r.name,
      bytes: Number(r.bytes),
      percent: total > 0 ? Math.round((Number(r.bytes) / total) * 1000) / 10 : 0,
    }));
  } catch {
    tables = null; // dbstat not compiled in — the dashboard says so instead of erroring
  }

  const totalBytes = pageSize !== null && pageCount !== null ? pageSize * pageCount : null;
  const freeBytes = pageSize !== null && freelistCount !== null ? pageSize * freelistCount : null;
  return { pageSize, pageCount, freelistCount, totalBytes, freeBytes, tables };
}

// Only meaningful for a local SQLite file — a remote libSQL/Turso URL has no local
// file to stat, so this returns null rather than throwing.
export function getDbFileSizeBytes(): number | null {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return null;
  const relativePath = url.slice("file:".length);
  const fullPath = path.join(process.cwd(), "prisma", relativePath);
  try {
    return fs.statSync(fullPath).size;
  } catch {
    return null;
  }
}
