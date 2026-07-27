import { prisma } from "@/lib/db";

// Read side of ChannelSyncLog — the Hub's Logs screen. Writes go through makeLogSink() in
// src/lib/channels/connection.ts; nothing here ever creates a row.

export type PublicSyncLog = {
  id: string;
  connectionId: string | null;
  connectionName: string;
  direction: string;
  operation: string;
  endpoint: string | null;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  requestSummary: string | null;
  responseSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type SyncLogFilters = {
  connectionId?: string;
  direction?: string;
  /** "ok" | "failed" — troubleshooting almost always starts from the failures. */
  outcome?: string;
  limit?: number;
  /** Opaque cursor: the id of the last row from the previous page. */
  cursor?: string;
};

// Bounded so a busy enterprise's log cannot be pulled in one request.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listSyncLogs(
  enterpriseId: string,
  filters: SyncLogFilters = {}
): Promise<{ logs: PublicSyncLog[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const rows = await prisma.channelSyncLog.findMany({
    where: {
      // Always scoped to the caller's own enterprise — never a client-supplied id.
      enterpriseId,
      ...(filters.connectionId ? { connectionId: filters.connectionId } : {}),
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(filters.outcome === "ok" ? { ok: true } : {}),
      ...(filters.outcome === "failed" ? { ok: false } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Cursor paging rather than offset: entries are written continuously, so an offset
    // page would silently skip or repeat rows as new ones arrive during paging.
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    take: take + 1,
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    logs: page.map((r) => ({
      id: r.id,
      connectionId: r.connectionId,
      connectionName: r.connectionName,
      direction: r.direction,
      operation: r.operation,
      endpoint: r.endpoint,
      ok: r.ok,
      httpStatus: r.httpStatus,
      latencyMs: r.latencyMs,
      requestSummary: r.requestSummary,
      responseSummary: r.responseSummary,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * Delete entries older than `days` for one enterprise, returning how many went.
 *
 * ChannelSyncLog grows with every exchange and nothing prunes it automatically yet — a
 * busy property syncing continuously would accumulate rows indefinitely. This is the
 * mechanism; scheduling it is still outstanding (recorded in TODO.md), so it is exposed
 * for a future job rather than left as an unwritten intention.
 */
export async function pruneSyncLogs(enterpriseId: string, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.channelSyncLog.deleteMany({
    where: { enterpriseId, createdAt: { lt: cutoff } },
  });
  return count;
}
