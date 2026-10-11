import { describe, it, expect } from "vitest";

const { prisma } = await import("@/lib/db");
const { negotiatedPlanError } = await import("@/lib/reservations/negotiated-access");
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Negotiated rate plans are only bookable through their agent", () => {
  it("allows a public plan for anyone, a negotiated plan only for its agent, and an edit that already carries it", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "NA", slug: `test-na-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({
      data: { enterpriseId: enterprise.id, name: "P", code: `NA-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    const pub = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "BAR", priority: 1 } });
    const neg = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "NEG", name: "Corporate", priority: 2, isNegotiated: true } });
    const agent = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "TRAVEL_AGENT", firstName: "A", companyName: "Agent A" } });
    const other = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "TRAVEL_AGENT", firstName: "B", companyName: "Agent B" } });
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: neg.id, upid: agent.upid } });

    expect(await negotiatedPlanError({ ratePlanIds: [pub.id], travelAgentId: null })).toBeNull();
    expect(await negotiatedPlanError({ ratePlanIds: [neg.id], travelAgentId: null })).toMatch(/negotiated/);
    expect(await negotiatedPlanError({ ratePlanIds: [neg.id], travelAgentId: other.upid })).toMatch(/Corporate/);
    expect(await negotiatedPlanError({ ratePlanIds: [neg.id], travelAgentId: agent.upid })).toBeNull();
    // A booking that already carries the plan stays editable.
    expect(await negotiatedPlanError({ ratePlanIds: [neg.id], travelAgentId: null, alreadyOnBooking: [neg.id] })).toBeNull();
  });
});
