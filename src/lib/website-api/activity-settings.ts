import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { enabledActivityModules, type ActivityModule } from "@/lib/website-api/scopes";

// Hub-side management of what each property sells ONLINE for Excursions and Spa
// (BOOKING_API_ADDONS_PLAN.md Phase 1): the per-property ActivityOnlineSettings row, and
// which excursion types / spa treatments are published, with their guest-facing copy.
//
// Lives in the Hub under INTEGRATIONS, beside WebsitePropertySettings, for the reason
// settings.ts gives for Allocation.publishToApi: distribution is the Hub's job. What an
// excursion or treatment IS (price, capacity, charge code) stays in Controls; this only
// decides whether it is also sold online and how the website describes it.
//
// Only modules the enterprise has as an add-on appear, and every write re-checks that.

export type ActivityItemDto = {
  id: string;
  code: string | null;
  name: string;
  group: string | null;
  isActive: boolean;
  publishOnline: boolean;
  publicDescription: string | null;
  imageUrls: string[];
  inclusions: string | null;
  /** Why this item cannot be published, if it can't (inactive; spa: walk-ins not allowed). */
  unpublishableReason: string | null;
};

export type ActivityModuleSettingsDto = {
  module: ActivityModule;
  configured: boolean;
  enabled: boolean;
  holdMinutes: number;
  leadHours: number;
  maxPartySize: number | null;
  offerGenderPreference: boolean;
  onlinePaymentMethodId: string | null;
  deskRemark: string | null;
  policies: string | null;
  /** This property's own outlet for the module is linked (Hub › the property › Charge Codes). */
  outletLinked: boolean;
  items: ActivityItemDto[];
};

export type ActivityPropertyDto = {
  property: { id: string; code: string; name: string; currency: string };
  // This property's own active payment methods — the only ones its online sales may use.
  paymentMethods: { id: string; name: string; type: string }[];
  modules: ActivityModuleSettingsDto[];
};

export type ActivitySettingsList = {
  modules: ActivityModule[];
  properties: ActivityPropertyDto[];
  // Per property since 2026-09-23 — each property's online payment method is one of its
  // own; see properties[].paymentMethods. Kept (empty) for older clients.
  paymentMethods: { id: string; name: string; type: string }[];
};

const DEFAULTS = {
  enabled: false,
  holdMinutes: 10,
  leadHours: 2,
  offerGenderPreference: true,
  onlinePaymentMethodId: null,
  deskRemark: null,
  policies: null,
};
const DEFAULT_MAX_PARTY: Record<ActivityModule, number | null> = { EXCURSIONS: 10, SPA: null };

export async function listActivitySettings(enterpriseId: string): Promise<ActivitySettingsList> {
  const modules = [...(await enabledActivityModules(enterpriseId))].sort() as ActivityModule[];
  const propertyScope = { enterpriseId, status: "ACTIVE" };
  const [properties, excursionTypes, spaTreatments, paymentMethods, links] = await Promise.all([
    prisma.property.findMany({
      where: propertyScope,
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, defaultCurrency: true, activityOnlineSettings: true },
    }),
    modules.includes("EXCURSIONS")
      ? prisma.excursionType.findMany({ where: { property: propertyScope }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    modules.includes("SPA")
      ? prisma.spaTreatment.findMany({
          where: { property: propertyScope },
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          include: { category: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.paymentMethod.findMany({
      where: { enterpriseId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, propertyId: true },
    }),
    // Each property's own module outlet links (per property since 2026-09-23).
    prisma.propertySettings.findMany({
      where: { property: propertyScope },
      select: { propertyId: true, excursionOutletId: true, spaOutletId: true },
    }),
  ]);
  const linksByProperty = new Map(links.map((l) => [l.propertyId, l]));

  return {
    modules,
    paymentMethods: [],
    properties: properties.map((p) => ({
      property: { id: p.id, code: p.code, name: p.name, currency: p.defaultCurrency },
      paymentMethods: paymentMethods
        .filter((m) => m.propertyId === p.id)
        .map(({ id, name, type }) => ({ id, name, type })),
      modules: modules.map((module) => {
        const s = p.activityOnlineSettings.find((r) => r.module === module);
        const items: ActivityItemDto[] =
          module === "EXCURSIONS"
            ? excursionTypes.filter((t) => t.propertyId === p.id).map((t) => ({
                id: t.id,
                code: t.code,
                name: t.name,
                group: null,
                isActive: t.isActive,
                publishOnline: t.publishOnline,
                publicDescription: t.publicDescription,
                imageUrls: t.imageUrls,
                inclusions: t.inclusions,
                unpublishableReason: t.isActive ? null : "Inactive",
              }))
            : spaTreatments.filter((t) => t.propertyId === p.id).map((t) => ({
                id: t.id,
                code: t.shortName,
                name: t.name,
                group: t.category.name,
                isActive: t.isActive,
                publishOnline: t.publishOnline,
                publicDescription: t.publicDescription,
                imageUrls: t.imageUrls,
                inclusions: t.inclusions,
                // Online guests are never linked to a stay (owner, 2026-09-23), so an online
                // booking is a walk-in booking: a treatment closed to walk-ins can't be sold.
                unpublishableReason: !t.isActive ? "Inactive" : !t.allowWalkIn ? "Not open to walk-in guests" : null,
              }));
        return {
          module,
          configured: !!s,
          enabled: s?.enabled ?? DEFAULTS.enabled,
          holdMinutes: s?.holdMinutes ?? DEFAULTS.holdMinutes,
          leadHours: s?.leadHours ?? DEFAULTS.leadHours,
          maxPartySize: s ? s.maxPartySize : DEFAULT_MAX_PARTY[module],
          offerGenderPreference: s?.offerGenderPreference ?? DEFAULTS.offerGenderPreference,
          onlinePaymentMethodId: s?.onlinePaymentMethodId ?? DEFAULTS.onlinePaymentMethodId,
          deskRemark: s?.deskRemark ?? DEFAULTS.deskRemark,
          policies: s?.policies ?? DEFAULTS.policies,
          outletLinked: !!(module === "EXCURSIONS" ? linksByProperty.get(p.id)?.excursionOutletId : linksByProperty.get(p.id)?.spaOutletId),
          items,
        };
      }),
    })),
  };
}

async function assertModuleAvailable(enterpriseId: string, module: string): Promise<ActivityModule> {
  if (module !== "EXCURSIONS" && module !== "SPA") throw new ForbiddenError(`Unknown module "${module}"`);
  if (!(await enabledActivityModules(enterpriseId)).has(module)) {
    throw new ForbiddenError(`${module === "SPA" ? "Spa" : "Excursions"} is not enabled for this enterprise`);
  }
  return module;
}

function cleanText(v: string | null | undefined, max: number, label: string): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? "").trim();
  if (t.length > max) throw new ForbiddenError(`${label} must be ${max} characters or fewer`);
  return t ? t : null;
}

function intInRange(v: number | undefined, min: number, max: number, label: string): number | undefined {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < min || v > max) throw new ForbiddenError(`${label} must be between ${min} and ${max}`);
  return v;
}

/** http(s) URLs only, blanks dropped — the same rule as the property's own photos. */
export function normalizeImageUrls(input: string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const v = raw.trim();
    if (!v) continue;
    try {
      const url = new URL(v);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      throw new ForbiddenError(`"${v}" is not a valid image URL`);
    }
    out.push(v);
  }
  if (out.length > 20) throw new ForbiddenError("At most 20 photos");
  return out;
}

export type ActivityModuleSettingsInput = {
  enabled?: boolean;
  holdMinutes?: number;
  leadHours?: number;
  maxPartySize?: number | null;
  offerGenderPreference?: boolean;
  onlinePaymentMethodId?: string | null;
  deskRemark?: string | null;
  policies?: string | null;
};

export async function updateActivityModuleSettings(params: {
  enterpriseId: string;
  propertyId: string;
  module: string;
  input: ActivityModuleSettingsInput;
}): Promise<ActivityModuleSettingsDto> {
  const { enterpriseId, propertyId, input } = params;
  const mod = await assertModuleAvailable(enterpriseId, params.module);
  const property = await prisma.property.findFirst({ where: { id: propertyId, enterpriseId, status: "ACTIVE" }, select: { id: true } });
  if (!property) throw new ForbiddenError("Property not found");

  if (input.onlinePaymentMethodId) {
    const method = await prisma.paymentMethod.findFirst({
      // One of THIS property's own payment methods.
      where: { id: input.onlinePaymentMethodId, propertyId, isActive: true },
      select: { id: true },
    });
    if (!method) throw new ForbiddenError("Payment method not found");
  }
  let maxPartySize: number | null | undefined;
  if (mod === "SPA") {
    maxPartySize = input.maxPartySize === undefined ? undefined : null; // spa uses each treatment's own limit
  } else if (input.maxPartySize !== undefined) {
    if (input.maxPartySize === null) throw new ForbiddenError("Set the largest party one online booking may carry");
    maxPartySize = intInRange(input.maxPartySize, 1, 100, "Largest party");
  }

  const data = {
    enabled: input.enabled,
    holdMinutes: intInRange(input.holdMinutes, 5, 60, "Hold time (minutes)"),
    leadHours: intInRange(input.leadHours, 0, 168, "Book-ahead time (hours)"),
    maxPartySize,
    offerGenderPreference: input.offerGenderPreference,
    onlinePaymentMethodId: input.onlinePaymentMethodId === undefined ? undefined : input.onlinePaymentMethodId || null,
    deskRemark: cleanText(input.deskRemark, 500, "Note for the desk"),
    policies: cleanText(input.policies, 5000, "Policies"),
  };

  await prisma.activityOnlineSettings.upsert({
    where: { propertyId_module: { propertyId, module: mod } },
    update: data,
    create: {
      propertyId,
      module: mod,
      enabled: data.enabled ?? DEFAULTS.enabled,
      holdMinutes: data.holdMinutes ?? DEFAULTS.holdMinutes,
      leadHours: data.leadHours ?? DEFAULTS.leadHours,
      maxPartySize: data.maxPartySize === undefined ? DEFAULT_MAX_PARTY[mod] : data.maxPartySize,
      offerGenderPreference: data.offerGenderPreference ?? DEFAULTS.offerGenderPreference,
      onlinePaymentMethodId: data.onlinePaymentMethodId ?? null,
      deskRemark: data.deskRemark ?? null,
      policies: data.policies ?? null,
    },
  });

  return findModuleDto(enterpriseId, propertyId, mod);
}

export type ActivityItemInput = {
  publishOnline?: boolean;
  publicDescription?: string | null;
  imageUrls?: string[];
  inclusions?: string | null;
};

export async function updateActivityItem(params: {
  enterpriseId: string;
  module: string;
  itemId: string;
  input: ActivityItemInput;
}): Promise<{ propertyId: string; item: ActivityItemDto }> {
  const { enterpriseId, itemId, input } = params;
  const mod = await assertModuleAvailable(enterpriseId, params.module);

  const data = {
    publishOnline: input.publishOnline,
    publicDescription: cleanText(input.publicDescription, 5000, "Description"),
    imageUrls: input.imageUrls === undefined ? undefined : normalizeImageUrls(input.imageUrls),
    inclusions: cleanText(input.inclusions, 2000, "Inclusions"),
  };

  let propertyId: string;
  if (mod === "EXCURSIONS") {
    const item = await prisma.excursionType.findFirst({
      where: { id: itemId, property: { enterpriseId } },
      select: { propertyId: true, isActive: true },
    });
    if (!item) throw new ForbiddenError("Excursion not found");
    if (input.publishOnline && !item.isActive) throw new ForbiddenError("An inactive excursion cannot be sold online");
    await prisma.excursionType.update({ where: { id: itemId }, data });
    propertyId = item.propertyId;
  } else {
    const item = await prisma.spaTreatment.findFirst({
      where: { id: itemId, property: { enterpriseId } },
      select: { propertyId: true, isActive: true, allowWalkIn: true },
    });
    if (!item) throw new ForbiddenError("Treatment not found");
    if (input.publishOnline && !item.isActive) throw new ForbiddenError("An inactive treatment cannot be sold online");
    if (input.publishOnline && !item.allowWalkIn) {
      throw new ForbiddenError("Online guests book as walk-ins — allow walk-in guests on this treatment first (Hub › property › Spa)");
    }
    await prisma.spaTreatment.update({ where: { id: itemId }, data });
    propertyId = item.propertyId;
  }

  const dto = await findModuleDto(enterpriseId, propertyId, mod);
  const item = dto.items.find((i) => i.id === itemId);
  if (!item) throw new ForbiddenError("Not found");
  return { propertyId, item };
}

async function findModuleDto(enterpriseId: string, propertyId: string, module: ActivityModule): Promise<ActivityModuleSettingsDto> {
  const all = await listActivitySettings(enterpriseId);
  const dto = all.properties.find((p) => p.property.id === propertyId)?.modules.find((m) => m.module === module);
  if (!dto) throw new ForbiddenError("Property not found");
  return dto;
}
