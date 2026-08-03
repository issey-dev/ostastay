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

// Storage breakdown. DUAL-ENGINE by design (app-owner decision, 2026-08-03): local
// development stays on SQLite while production runs PostgreSQL, so this probes whichever
// engine is actually connected rather than assuming one. The engine is read from
// DATABASE_URL — the same string Prisma itself dispatches on — and every branch is
// read-only SQL that degrades to nulls rather than throwing, so a locked-down role or an
// unexpected engine leaves the dashboard showing "N/A" instead of erroring the page.
//
// The two engines genuinely expose different things, so the shared shape below is the
// honest intersection:
//   SQLite      pageSize/pageCount/freelistCount from PRAGMAs; per-table bytes from the
//               dbstat virtual table (a compile-time option — probed, never assumed).
//   PostgreSQL  totalBytes from pg_database_size(); pages derived from the block_size
//               GUC; "reclaimable" is dead-tuple bytes estimated from
//               pg_stat_user_tables — what a VACUUM FULL would release, the closest
//               analogue of SQLite's freelist, and approximate for the same reason the
//               stats collector's own counts are; per-table bytes from
//               pg_total_relation_size(), with the index-only share broken out.
export type DbEngine = "sqlite" | "postgresql" | "unknown";

export function detectDbEngine(url = process.env.DATABASE_URL): DbEngine {
  if (!url) return "unknown";
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgresql";
  return "unknown";
}

export type StorageStats = {
  engine: DbEngine;
  pageSize: number | null;
  pageCount: number | null;
  /** SQLite: freelist pages. PostgreSQL: dead tuples. Both mean "a reclaim would free this". */
  freelistCount: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  /** indexBytes is PostgreSQL-only — SQLite's dbstat lists indexes as their own rows. */
  tables: Array<{ name: string; bytes: number; percent: number; indexBytes: number | null }> | null;
};

/** Share of the LISTED tables, matching what the dashboard's bars draw. */
function withPercent(
  rows: Array<{ name: string; bytes: number; indexBytes: number | null }>
): NonNullable<StorageStats["tables"]> {
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  return rows.map((r) => ({
    ...r,
    percent: total > 0 ? Math.round((r.bytes / total) * 1000) / 10 : 0,
  }));
}

async function getSqliteStorage(): Promise<StorageStats> {
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
    // PRAGMA blocked — leave everything null.
  }

  let tables: StorageStats["tables"] = null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; bytes: number | bigint }>>(
      `SELECT name, SUM(pgsize) AS bytes FROM dbstat WHERE name NOT LIKE 'sqlite_%' GROUP BY name ORDER BY bytes DESC LIMIT 30`
    );
    tables = withPercent(rows.map((r) => ({ name: r.name, bytes: Number(r.bytes), indexBytes: null })));
  } catch {
    tables = null; // dbstat not compiled in — the dashboard says so instead of erroring.
  }

  return {
    engine: "sqlite",
    pageSize,
    pageCount,
    freelistCount,
    totalBytes: pageSize !== null && pageCount !== null ? pageSize * pageCount : null,
    freeBytes: pageSize !== null && freelistCount !== null ? pageSize * freelistCount : null,
    tables,
  };
}

async function getPostgresStorage(): Promise<StorageStats> {
  let pageSize: number | null = null;
  let totalBytes: number | null = null;
  try {
    const [row] = await prisma.$queryRawUnsafe<Array<{ block_size: string; db_size: bigint | number }>>(
      `SELECT current_setting('block_size') AS block_size, pg_database_size(current_database()) AS db_size`
    );
    pageSize = row ? Number(row.block_size) : null;
    totalBytes = row ? Number(row.db_size) : null;
  } catch {
    // Role cannot read the catalog — leave nulls and let the dashboard say "N/A".
  }

  let freelistCount: number | null = null;
  let freeBytes: number | null = null;
  try {
    const [row] = await prisma.$queryRawUnsafe<Array<{ dead: bigint | number; dead_bytes: bigint | number | null }>>(
      `SELECT COALESCE(SUM(s.n_dead_tup), 0) AS dead,
              COALESCE(SUM(
                s.n_dead_tup
                * (pg_relation_size(s.relid) / NULLIF(s.n_live_tup + s.n_dead_tup, 0))
              ), 0) AS dead_bytes
         FROM pg_stat_user_tables s`
    );
    freelistCount = row ? Number(row.dead) : null;
    freeBytes = row && row.dead_bytes !== null ? Number(row.dead_bytes) : null;
  } catch {
    freelistCount = null;
    freeBytes = null;
  }

  let tables: StorageStats["tables"] = null;
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ name: string; bytes: bigint | number; index_bytes: bigint | number }>
    >(
      `SELECT c.relname AS name,
              pg_total_relation_size(c.oid) AS bytes,
              pg_indexes_size(c.oid) AS index_bytes
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 30`
    );
    tables = withPercent(
      rows.map((r) => ({ name: r.name, bytes: Number(r.bytes), indexBytes: Number(r.index_bytes) }))
    );
  } catch {
    tables = null;
  }

  return {
    engine: "postgresql",
    pageSize,
    pageCount: pageSize !== null && totalBytes !== null ? Math.round(totalBytes / pageSize) : null,
    freelistCount,
    totalBytes,
    freeBytes,
    tables,
  };
}

export async function getStorageStats(): Promise<StorageStats> {
  const engine = detectDbEngine();
  if (engine === "sqlite") return getSqliteStorage();
  if (engine === "postgresql") return getPostgresStorage();
  return {
    engine,
    pageSize: null,
    pageCount: null,
    freelistCount: null,
    totalBytes: null,
    freeBytes: null,
    tables: null,
  };
}

// The on-disk file, for a LOCAL SQLite database only — development keeps SQLite, so this
// stays useful there. A PostgreSQL (or remote libSQL) URL has no local file to stat and
// returns null, which the dashboard renders as a server-hosted database instead.
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
