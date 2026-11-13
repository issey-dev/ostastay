import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { getBooking } from "@/lib/agent-api/bookings";

// GET /bookings/{ref}
export const GET = agentRoute<{ ref: string }>(async (ctx) => apiJson(await getBooking(requireAgent(ctx), ctx.propertyIds, ctx.params.ref)));
