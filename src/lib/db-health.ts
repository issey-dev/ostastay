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
