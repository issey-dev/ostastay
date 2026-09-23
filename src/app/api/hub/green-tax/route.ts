import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registerOverview } from "@/lib/green-tax-registry";
import { greenTaxContext, greenTaxError } from "./_shared";

/** GET /api/hub/green-tax?propertyId=…&year=… — the year's register: months, flagged registrations, gaps, history. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { ctx, propertyId } = await greenTaxContext("view", url.searchParams.get("propertyId"));
    const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
    const overview = await registerOverview(propertyId, year);

    // Names for "filed by" / "corrected by".
    const userIds = [...new Set([...overview.months.map((m) => m.filedById), ...overview.corrections.map((c) => c.userId)].filter(Boolean) as string[])];
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, enterpriseId: ctx.enterpriseId }, select: { id: true, firstName: true, lastName: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, `${u.firstName} ${u.lastName ?? ""}`.trim()]));
    return NextResponse.json({ ...overview, userNames: names }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return greenTaxError(error);
  }
}
