import { describe, it, expect } from "vitest";
import { detectDbEngine, getStorageStats } from "@/lib/db-health";

// The DB Health storage panel must work on BOTH engines (app-owner decision,
// 2026-08-03): development stays on SQLite, production runs PostgreSQL. Before this the
// probe only spoke SQLite's PRAGMA/dbstat dialect, so every card on the panel read "N/A"
// once production moved to Postgres.
describe("DB health storage probe", () => {
  it("detects the engine from DATABASE_URL, never guessing", () => {
    expect(detectDbEngine("file:./dev.db")).toBe("sqlite");
    expect(detectDbEngine("postgresql://osta:pw@localhost:5432/ostastay")).toBe("postgresql");
    expect(detectDbEngine("postgres://osta:pw@host/db")).toBe("postgresql");
    // Anything unrecognised is reported as such rather than assumed to be one of them —
    // the dashboard then says so instead of running the wrong dialect's SQL.
    expect(detectDbEngine("mysql://user@host/db")).toBe("unknown");
    expect(detectDbEngine("")).toBe("unknown");
    // Omitting the argument deliberately falls back to DATABASE_URL — that default is
    // how every caller uses it, so it must resolve the live engine, not "unknown".
    expect(detectDbEngine()).toBe(detectDbEngine(process.env.DATABASE_URL));
    expect(detectDbEngine()).not.toBe("unknown");
  });

  it("reads real numbers off the connected engine", async () => {
    const stats = await getStorageStats();

    // The suite runs against whatever the test DATABASE_URL points at — assert on the
    // shape and internal consistency rather than the engine, so this test stays honest
    // on both.
    expect(stats.engine).toBe(detectDbEngine());
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.pageSize).toBeGreaterThan(0);
    expect(stats.pageCount).toBeGreaterThan(0);
    // Reclaimable is a subset of the database, never larger than it.
    if (stats.freeBytes !== null && stats.totalBytes !== null) {
      expect(stats.freeBytes).toBeLessThanOrEqual(stats.totalBytes);
    }

    // A migrated database always has tables; the breakdown only goes null when the
    // engine cannot report it (no dbstat / no catalog access).
    expect(stats.tables).not.toBeNull();
    const tables = stats.tables!;
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.length).toBeLessThanOrEqual(30);

    for (const t of tables) {
      expect(t.bytes).toBeGreaterThanOrEqual(0);
      expect(t.percent).toBeGreaterThanOrEqual(0);
      expect(t.percent).toBeLessThanOrEqual(100);
      // Indexes are part of the reported total on Postgres, so they cannot exceed it.
      if (t.indexBytes !== null) expect(t.indexBytes).toBeLessThanOrEqual(t.bytes);
    }

    // Biggest first — the panel's whole purpose is "what is eating the space".
    const sizes = tables.map((t) => t.bytes);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);

    // Shares are of the listed tables, so they add up to ~100% (rounding to 0.1 each).
    const sum = tables.reduce((n, t) => n + t.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(tables.length * 0.1 + 0.5);
  });
});
