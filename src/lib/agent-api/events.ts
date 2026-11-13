import { prisma } from "@/lib/db";
import { attemptDelivery, type WebhookEvent } from "@/lib/website-api/webhooks";

// Agent webhooks (Agent Portal plan §6). An event about a Source's booking or slot goes to the
// webhook endpoints of the AGENT keys that Source's own logins sign in through, so an agent's
// own system hears about its own bookings and nobody else's. Never throws: a webhook problem
// must not fail the desk or portal action that caused it. Delivery, retries and signing are
// the Booking API's (src/lib/website-api/webhooks.ts).

export async function emitAgentEvent(sourceProfileId: string, enterpriseId: string, event: Exclude<WebhookEvent, "ping">, data: unknown) {
  try {
    const sessions = await prisma.agentSession.findMany({
      where: { agentUser: { sourceProfileId } },
      select: { keyId: true },
      distinct: ["keyId"],
    });
    const keyIds = sessions.map((s) => s.keyId);
    if (keyIds.length === 0) return;
    const endpoints = await prisma.apiWebhookEndpoint.findMany({
      where: { keyId: { in: keyIds }, status: "ACTIVE", events: { has: event }, key: { scopes: { has: "AGENT" }, enterpriseId } },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const e of endpoints) {
      const d = await prisma.apiWebhookDelivery.create({ data: { enterpriseId, endpointId: e.id, event, payload: {}, nextAttemptAt: new Date() } });
      await prisma.apiWebhookDelivery.update({
        where: { id: d.id },
        data: { payload: { id: d.id, event, createdAt: d.createdAt.toISOString(), data } as object },
      });
      ids.push(d.id);
    }
    void Promise.allSettled(ids.map((id) => attemptDelivery(id)));
  } catch (e) {
    console.error("[agent-api webhooks] emit failed", e);
  }
}

/** Desk-side changes to an agent booking (confirmed, released, changed): tell the agent. */
export async function emitForReservation(reservationId: string, event: Exclude<WebhookEvent, "ping">) {
  try {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { agentRef: true, sourceProfileId: true, status: true, confirmationNo: true, property: { select: { enterpriseId: true } } },
    });
    if (!r?.agentRef || !r.sourceProfileId) return;
    await emitAgentEvent(r.sourceProfileId, r.property.enterpriseId, event, { ref: r.agentRef, confirmationNo: r.confirmationNo, status: r.status });
  } catch (e) {
    console.error("[agent-api webhooks] reservation emit failed", e);
  }
}
