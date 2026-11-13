import { agentRoute, apiJson, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { createBookingsInSlot } from "@/lib/agent-api/bookings";
import { AgentApiError } from "@/lib/agent-api/http";

// POST /slots/{code}/rooming-list  { rooms: [...same as bookings...] } or text/csv
//   checkIn,checkOut,roomTypeId,adults,children,firstName,lastName,email,agentReference
// Many bookings at once, applied line by line: each line is its own booking and gets its own
// result, so one bad line does not stop the others.
export const POST = agentRoute<{ code: string }>(async (ctx) => {
  const agent = requireAgent(ctx);
  let lines: Record<string, unknown>[] = [];
  if ((ctx.request.headers.get("content-type") ?? "").includes("text/csv")) {
    const text = await ctx.request.text();
    const [head, ...rest] = text.split(/\r?\n/).filter((l) => l.trim());
    const cols = (head ?? "").split(",").map((c) => c.trim());
    lines = rest.map((l) => {
      const v = l.split(",").map((x) => x.trim());
      const o = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""]));
      return { ...o, leadGuest: { firstName: o.firstName, lastName: o.lastName, email: o.email || undefined } };
    });
  } else {
    const body = await jsonBody(ctx.request);
    lines = Array.isArray(body.rooms) ? (body.rooms as Record<string, unknown>[]) : [];
  }
  if (lines.length === 0 || lines.length > 200) throw new AgentApiError(400, "INVALID_BODY", "Send 1 to 200 lines.");
  const results = [];
  for (const [i, line] of lines.entries()) {
    try {
      const [b] = await createBookingsInSlot(agent, ctx.propertyIds, ctx.params.code, { rooms: [line] });
      results.push({ line: i + 1, ok: true, ref: b.ref });
    } catch (e) {
      results.push({ line: i + 1, ok: false, code: e instanceof AgentApiError ? e.code : "REFUSED", error: e instanceof Error ? e.message.replace(/^Room 1: /, "") : "Refused" });
    }
  }
  return apiJson({ accepted: results.filter((r) => r.ok).length, results }, { status: 207 });
});
