import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { apiJson, apiError } from "@/lib/website-api/http";
import type { NextResponse } from "next/server";

// Idempotent writes on the Agent API (Agent Portal plan §6: "Writes need Idempotency-Key").
// The same key + Idempotency-Key replays the stored answer; the same Idempotency-Key with a
// different body is 409 IDEMPOTENCY_CONFLICT. A double click or a retry never books twice.

export async function idempotent(
  request: Request,
  keyId: string,
  body: unknown,
  run: () => Promise<{ status: number; data: unknown }>
): Promise<NextResponse> {
  const idemKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idemKey.length < 8 || idemKey.length > 128) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header (8 to 128 characters) with every write.");
  }
  const hash = createHash("sha256").update(`${new URL(request.url).pathname}|${JSON.stringify(body ?? null)}`).digest("hex");
  const seen = await prisma.agentIdempotency.findUnique({ where: { keyId_idempotencyKey: { keyId, idempotencyKey: idemKey } } });
  if (seen) {
    if (seen.requestHash !== hash) return apiError(409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used for a different request.");
    return apiJson(seen.response, { status: seen.status, headers: { "Idempotent-Replay": "true" } });
  }
  const { status, data } = await run();
  await prisma.agentIdempotency
    .create({ data: { keyId, idempotencyKey: idemKey, requestHash: hash, status, response: (data ?? null) as object } })
    .catch(() => undefined); // a concurrent duplicate already stored it; this answer stands
  return apiJson(data, { status });
}
