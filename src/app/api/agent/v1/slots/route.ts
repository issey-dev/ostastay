import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { listSlots } from "@/lib/agent-api/bookings";

// GET /slots?status=AWAITING_HOTEL|TENTATIVE|DEFINITE|DECLINED — the agent's own slots.
export const GET = agentRoute(async (ctx) => {
  const status = new URL(ctx.request.url).searchParams.get("status");
  return apiJson({ slots: await listSlots(requireAgent(ctx), ctx.propertyIds, { status }) });
});
