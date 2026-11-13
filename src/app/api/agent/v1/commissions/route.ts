import { prisma } from "@/lib/db";
import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";

// GET /api/agent/v1/commissions?status=ACCRUED|APPROVED|PAID|NETTED — the agent's commission
// lines across the properties they work with (no other agent's, ever).
export const GET = agentRoute(async (ctx) => {
  const agent = requireAgent(ctx);
  const status = new URL(ctx.request.url).searchParams.get("status");
  const rows = await prisma.agentCommission.findMany({
    where: { profileId: agent.sourceProfileId, propertyId: { in: ctx.propertyIds }, status: status ? status : { not: "REVERSED" } },
    orderBy: { businessDate: "desc" },
    take: 500,
  });
  const res = await prisma.reservation.findMany({ where: { id: { in: rows.map((r) => r.reservationId) } }, select: { id: true, agentRef: true, confirmationNo: true } });
  return apiJson({
    commissions: rows.map((r) => ({
      date: r.businessDate.toISOString().slice(0, 10),
      propertyId: r.propertyId,
      booking: res.find((x) => x.id === r.reservationId)?.agentRef ?? res.find((x) => x.id === r.reservationId)?.confirmationNo ?? null,
      base: r.baseAmount,
      rate: r.rate,
      amount: r.amount,
      mode: r.mode,
      status: r.status,
    })),
  });
});
