import { PrismaClient } from "@prisma/client";
import { recordQuery, recordEngineEvent, recordModelOp } from "@/lib/db-metrics";
import { getRequestTenantContext } from "@/lib/request-context";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createClient() {
  const base = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

  // Feeds the Osta "DB Health" dashboard (src/lib/db-metrics.ts) — a bounded
  // in-memory ring buffer, not a persisted table (see .agents/docs/DECISIONS.md for
  // why: this is a per-process, since-last-restart view, not a historical trend tool).
  base.$on("query" as never, (e: { query: string; duration: number; timestamp: Date }) => {
    recordQuery(e.query, e.duration, e.timestamp);
  });
  base.$on("error" as never, (e: { message: string; timestamp: Date }) => {
    recordEngineEvent("error", e.message, e.timestamp);
  });
  base.$on("warn" as never, (e: { message: string; timestamp: Date }) => {
    recordEngineEvent("warn", e.message, e.timestamp);
  });

  // Second metrics layer: model-operation timing WITH tenant attribution. The $on
  // handlers above run on the engine's event emitter and lose the request's async
  // context, so they can never know which enterprise ran a query; this extension wraps
  // the operation inside the request itself, where the AsyncLocalStorage set by
  // requireSession() is still live. Raw $queryRaw/$executeRaw calls are not covered.
  // The recorder must never break a real query — hence the try/catch around it.
  const client = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          try {
            return await query(args);
          } finally {
            try {
              recordModelOp(model, operation, performance.now() - start, getRequestTenantContext());
            } catch {
              // metrics are best-effort
            }
          }
        },
      },
    },
  });

  // Cast back to the base type: extending doesn't remove any model delegate or
  // $transaction surface this codebase uses, and every import site types against
  // PrismaClient. ($on is intentionally called on `base` above — extended clients
  // don't expose it.)
  return client as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
