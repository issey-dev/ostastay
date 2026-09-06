import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";

// Hub-side management of what each property's brand website may show and sell — the
// WebsitePropertySettings row. Configuration, not operation (the Hub's rule), so it takes
// an explicit propertyId and never an ambient "current property".

export type WebsitePropertySettingsDto = {
  property: { id: string; code: string; name: string; currency: string; status: string };
  configured: boolean;
  headline: string | null;
  description: string | null;
  imageUrls: string[];
  policies: string | null;
  bookingEnabled: boolean;
  ratePlanId: string | null;
  mealPlanCode: string;
  maxNightsAhead: number;
  minNights: number;
  deskRemark: string | null;
  /** Plans the Hub may choose from. Negotiated plans are excluded — they are agent-only. */
  ratePlans: { id: string; code: string; name: string; isLocked: boolean; parentRatePlanId: string | null }[];
  mealPlans: { code: string; name: string }[];
  /** Active keys that can act on this property. */
  keyCount: number;
  bookingCount: number;
};

const DEFAULTS = {
  headline: null,
  description: null,
  imageUrls: [] as string[],
  policies: null,
  bookingEnabled: true,
  ratePlanId: null,
  mealPlanCode: "NONE",
  maxNightsAhead: 365,
  minNights: 1,
  deskRemark: null,
};

export async function listWebsitePropertySettings(enterpriseId: string): Promise<WebsitePropertySettingsDto[]> {
  const properties = await prisma.property.findMany({
    where: { enterpriseId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      defaultCurrency: true,
      status: true,
      websiteSettings: true,
      ratePlans: {
        where: { isNegotiated: false },
        orderBy: [{ isLocked: "desc" }, { priority: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, isLocked: true, parentRatePlanId: true },
      },
      mealPlans: { where: { isActive: true }, orderBy: { name: "asc" }, select: { code: true, name: true } },
      _count: {
        select: {
          websiteApiKeys: { where: { key: { status: "ACTIVE" } } },
          websiteBookings: { where: { status: "CONFIRMED" } },
        },
      },
    },
  });

  return properties.map((p) => {
    const s = p.websiteSettings;
    return {
      property: { id: p.id, code: p.code, name: p.name, currency: p.defaultCurrency, status: p.status },
      configured: !!s,
      headline: s?.headline ?? DEFAULTS.headline,
      description: s?.description ?? DEFAULTS.description,
      imageUrls: s?.imageUrls ?? DEFAULTS.imageUrls,
      policies: s?.policies ?? DEFAULTS.policies,
      bookingEnabled: s?.bookingEnabled ?? DEFAULTS.bookingEnabled,
      ratePlanId: s?.ratePlanId ?? DEFAULTS.ratePlanId,
      mealPlanCode: s?.mealPlanCode ?? DEFAULTS.mealPlanCode,
      maxNightsAhead: s?.maxNightsAhead ?? DEFAULTS.maxNightsAhead,
      minNights: s?.minNights ?? DEFAULTS.minNights,
      deskRemark: s?.deskRemark ?? DEFAULTS.deskRemark,
      ratePlans: p.ratePlans,
      mealPlans: p.mealPlans,
      keyCount: p._count.websiteApiKeys,
      bookingCount: p._count.websiteBookings,
    };
  });
}

export type WebsitePropertySettingsInput = {
  headline?: string | null;
  description?: string | null;
  imageUrls?: string[];
  policies?: string | null;
  bookingEnabled?: boolean;
  ratePlanId?: string | null;
  mealPlanCode?: string;
  maxNightsAhead?: number;
  minNights?: number;
  deskRemark?: string | null;
};

function cleanText(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? "").trim();
  return t ? t : null;
}

export async function updateWebsitePropertySettings(params: {
  enterpriseId: string;
  propertyId: string;
  input: WebsitePropertySettingsInput;
}): Promise<WebsitePropertySettingsDto> {
  const { enterpriseId, propertyId, input } = params;
  const property = await prisma.property.findFirst({ where: { id: propertyId, enterpriseId, status: "ACTIVE" }, select: { id: true } });
  if (!property) throw new ForbiddenError("Property not found");

  if (input.ratePlanId) {
    const plan = await prisma.ratePlan.findFirst({ where: { id: input.ratePlanId, propertyId }, select: { isNegotiated: true } });
    if (!plan) throw new ForbiddenError("Rate plan does not belong to this property");
    if (plan.isNegotiated) throw new ForbiddenError("A negotiated rate plan cannot be sold on the website");
  }
  if (input.maxNightsAhead !== undefined && (!Number.isInteger(input.maxNightsAhead) || input.maxNightsAhead < 1 || input.maxNightsAhead > 730)) {
    throw new ForbiddenError("Booking window must be between 1 and 730 nights");
  }
  if (input.minNights !== undefined && (!Number.isInteger(input.minNights) || input.minNights < 1 || input.minNights > 30)) {
    throw new ForbiddenError("Minimum stay must be between 1 and 30 nights");
  }
  let imageUrls: string[] | undefined;
  if (input.imageUrls !== undefined) {
    imageUrls = [];
    for (const raw of input.imageUrls) {
      const v = raw.trim();
      if (!v) continue;
      try {
        const url = new URL(v);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      } catch {
        throw new ForbiddenError(`"${v}" is not a valid image URL`);
      }
      imageUrls.push(v);
    }
  }

  const data = {
    headline: cleanText(input.headline),
    description: cleanText(input.description),
    imageUrls,
    policies: cleanText(input.policies),
    bookingEnabled: input.bookingEnabled,
    ratePlanId: input.ratePlanId === undefined ? undefined : input.ratePlanId || null,
    mealPlanCode: input.mealPlanCode === undefined ? undefined : input.mealPlanCode.trim() || "NONE",
    maxNightsAhead: input.maxNightsAhead,
    minNights: input.minNights,
    deskRemark: cleanText(input.deskRemark),
  };

  await prisma.websitePropertySettings.upsert({
    where: { propertyId },
    update: data,
    create: {
      propertyId,
      headline: data.headline ?? null,
      description: data.description ?? null,
      imageUrls: data.imageUrls ?? [],
      policies: data.policies ?? null,
      bookingEnabled: data.bookingEnabled ?? true,
      ratePlanId: data.ratePlanId ?? null,
      mealPlanCode: data.mealPlanCode ?? "NONE",
      maxNightsAhead: data.maxNightsAhead ?? 365,
      minNights: data.minNights ?? 1,
      deskRemark: data.deskRemark ?? null,
    },
  });

  const all = await listWebsitePropertySettings(enterpriseId);
  const row = all.find((r) => r.property.id === propertyId);
  if (!row) throw new ForbiddenError("Property not found");
  return row;
}
