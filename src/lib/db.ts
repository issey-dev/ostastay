import { PrismaClient } from "@prisma/client";
import { recordQuery, recordEngineEvent } from "@/lib/db-metrics";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createClient() {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

  // Feeds the Osta "DB Health" dashboard (src/lib/db-metrics.ts) — a bounded
  // in-memory ring buffer, not a persisted table (see .agents/docs/DECISIONS.md for
  // why: this is a per-process, since-last-restart view, not a historical trend tool).
  client.$on("query" as never, (e: { query: string; duration: number; timestamp: Date }) => {
    recordQuery(e.query, e.duration, e.timestamp);
  });
  client.$on("error" as never, (e: { message: string; timestamp: Date }) => {
    recordEngineEvent("error", e.message, e.timestamp);
  });
  client.$on("warn" as never, (e: { message: string; timestamp: Date }) => {
    recordEngineEvent("warn", e.message, e.timestamp);
  });

  return client;
}

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
