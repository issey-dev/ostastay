import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { listBookings } from "@/lib/agent-api/bookings";

// GET /bookings?status=ON_OPTION|CONFIRMATION_REQUESTED|CONFIRMED|IN_HOUSE|COMPLETED|CANCELLED&from&to&q&page
export const GET = agentRoute(async (ctx) => {
  const u = new URL(ctx.request.url).searchParams;
  return apiJson(
    await listBookings(requireAgent(ctx), ctx.propertyIds, {
      status: u.get("status"),
      from: u.get("from"),
      to: u.get("to"),
      q: u.get("q"),
      page: Number(u.get("page") ?? 1) || 1,
    })
  );
});
