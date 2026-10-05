import { websitePreflight, apiJson, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { getTransportSettings, propertyTz } from "@/lib/transport/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId}/transport
 * Whether Transportation is on at this property, and the settings an integration needs:
 * time zone (every local time in this API is in it), currency, the attention tolerance.
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ key, params, cors }) => {
  await transportGate(key, params.propertyId, { operations: false });
  const [s, p] = await Promise.all([getTransportSettings(params.propertyId), propertyTz(params.propertyId)]);
  return apiJson(
    {
      propertyId: params.propertyId,
      enabled: s.enabled,
      timeZone: p.timeZone,
      currency: p.defaultCurrency,
      pricesIncludeTaxes: p.pricesIncludeTaxes,
      attentionToleranceMinutes: s.attentionToleranceMinutes,
      requireProvider: s.requireProvider,
    },
    { headers: cors }
  );
});

export const OPTIONS = websitePreflight;
