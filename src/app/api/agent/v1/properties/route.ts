import { prisma } from "@/lib/db";
import { agentRoute, apiJson } from "@/lib/agent-api/http";

// GET /api/agent/v1/properties — the properties this key serves with the agent portal on.
export const GET = agentRoute(async ({ propertyIds }) => {
  const rows = await prisma.property.findMany({
    where: { id: { in: propertyIds } },
    select: { id: true, name: true, code: true, defaultCurrency: true },
    orderBy: { name: "asc" },
  });
  return apiJson({ properties: rows.map((p) => ({ id: p.id, name: p.name, code: p.code, currency: p.defaultCurrency })) });
});
