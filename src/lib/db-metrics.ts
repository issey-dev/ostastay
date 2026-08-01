// In-memory, per-process query/engine-event collector feeding the Osta "DB Health"
// dashboard (src/app/osta/db-health). Deliberately NOT a persisted table — a
// since-last-restart rolling window, not a historical-trend tool. On a
// multi-instance/serverless deployment this only reflects whichever instance served
// the request; the dashboard's own copy calls this out explicitly rather than
// implying it's a global aggregate.
//
// State lives on globalThis (same pattern as src/lib/db.ts's PrismaClient caching) so
// Next.js dev's module hot-reload doesn't silently reset the buffer on every save.

type QueryEvent = { query: string; duration: number; timestamp: number };
type EngineEvent = { level: "error" | "warn"; message: string; timestamp: number };
// A Prisma model operation (e.g. Reservation.findMany), tagged with the tenant that
// ran it — recorded by the client extension in src/lib/db.ts using the ambient
// request context (src/lib/request-context.ts). This is the layer that CAN carry
// tenant identity; the raw SQL events above come off the engine's event emitter,
// which does not preserve the request's async context.
type ModelOpEvent = {
  model: string;
  operation: string;
  duration: number;
  timestamp: number;
  enterpriseId: string | null;
  propertyId: string | null;
};

const MAX_QUERY_EVENTS = 500;
const MAX_ENGINE_EVENTS = 100;
const MAX_MODEL_OP_EVENTS = 2000;

const globalForMetrics = globalThis as unknown as {
  __dbQueryEvents?: QueryEvent[];
  __dbEngineEvents?: EngineEvent[];
  __dbModelOpEvents?: ModelOpEvent[];
};

const queryEvents = globalForMetrics.__dbQueryEvents ?? (globalForMetrics.__dbQueryEvents = []);
const engineEvents = globalForMetrics.__dbEngineEvents ?? (globalForMetrics.__dbEngineEvents = []);
const modelOpEvents = globalForMetrics.__dbModelOpEvents ?? (globalForMetrics.__dbModelOpEvents = []);

// Collapses whitespace only — Prisma's query log already shows parameterized SQL
// (placeholders, not literal values), so grouping by the raw text is already
// meaningful without any literal-stripping.
function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

export function recordQuery(query: string, duration: number, timestamp: Date): void {
  queryEvents.push({ query: normalizeQuery(query), duration, timestamp: timestamp.getTime() });
  if (queryEvents.length > MAX_QUERY_EVENTS) queryEvents.shift();
}

export function recordEngineEvent(level: "error" | "warn", message: string, timestamp: Date): void {
  engineEvents.push({ level, message, timestamp: timestamp.getTime() });
  if (engineEvents.length > MAX_ENGINE_EVENTS) engineEvents.shift();
}

export type QueryStatRow = { query: string; count: number; avgMs: number; maxMs: number; totalMs: number };

export function getQueryStats(): QueryStatRow[] {
  const groups = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const e of queryEvents) {
    const g = groups.get(e.query) ?? { count: 0, totalMs: 0, maxMs: 0 };
    g.count += 1;
    g.totalMs += e.duration;
    g.maxMs = Math.max(g.maxMs, e.duration);
    groups.set(e.query, g);
  }
  return Array.from(groups.entries())
    .map(([query, g]) => ({
      query,
      count: g.count,
      avgMs: Math.round((g.totalMs / g.count) * 10) / 10,
      maxMs: Math.round(g.maxMs * 10) / 10,
      totalMs: Math.round(g.totalMs * 10) / 10,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function getSlowestQueries(n = 20): QueryEvent[] {
  return [...queryEvents].sort((a, b) => b.duration - a.duration).slice(0, n);
}

export function getRecentEngineEvents(n = 20): EngineEvent[] {
  return engineEvents.slice(-n).reverse();
}

export function getBufferInfo(): { queryEventCount: number; bufferCapacity: number; oldestTimestamp: number | null } {
  return {
    queryEventCount: queryEvents.length,
    bufferCapacity: MAX_QUERY_EVENTS,
    oldestTimestamp: queryEvents[0]?.timestamp ?? null,
  };
}

export function recordModelOp(
  model: string,
  operation: string,
  duration: number,
  tenant: { enterpriseId: string; propertyId: string | null } | null
): void {
  modelOpEvents.push({
    model,
    operation,
    duration,
    timestamp: Date.now(),
    enterpriseId: tenant?.enterpriseId ?? null,
    propertyId: tenant?.propertyId ?? null,
  });
  if (modelOpEvents.length > MAX_MODEL_OP_EVENTS) modelOpEvents.shift();
}

// Pre-aggregated per (tenant, model, operation) — the dashboard filters/re-groups
// client-side, so one payload serves both the "by enterprise/property" and the
// "by model" views without re-fetching.
export type TenantOpStatRow = {
  enterpriseId: string | null;
  propertyId: string | null;
  model: string;
  operation: string;
  count: number;
  avgMs: number;
  maxMs: number;
  totalMs: number;
};

export function getTenantOpStats(): TenantOpStatRow[] {
  const groups = new Map<string, { row: Omit<TenantOpStatRow, "count" | "avgMs" | "maxMs" | "totalMs">; count: number; totalMs: number; maxMs: number }>();
  for (const e of modelOpEvents) {
    const key = `${e.enterpriseId}|${e.propertyId}|${e.model}|${e.operation}`;
    const g = groups.get(key) ?? {
      row: { enterpriseId: e.enterpriseId, propertyId: e.propertyId, model: e.model, operation: e.operation },
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    g.count += 1;
    g.totalMs += e.duration;
    g.maxMs = Math.max(g.maxMs, e.duration);
    groups.set(key, g);
  }
  return Array.from(groups.values())
    .map((g) => ({
      ...g.row,
      count: g.count,
      avgMs: Math.round((g.totalMs / g.count) * 10) / 10,
      maxMs: Math.round(g.maxMs * 10) / 10,
      totalMs: Math.round(g.totalMs * 10) / 10,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function getModelOpBufferInfo(): { eventCount: number; bufferCapacity: number; oldestTimestamp: number | null } {
  return {
    eventCount: modelOpEvents.length,
    bufferCapacity: MAX_MODEL_OP_EVENTS,
    oldestTimestamp: modelOpEvents[0]?.timestamp ?? null,
  };
}
