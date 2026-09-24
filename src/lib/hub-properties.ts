import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import { canSetUpProperty, type AuthContext } from "@/lib/scope"
import type { HubAddon } from "@/components/hub/hub-nav"

// Which properties a user may open in the Hub's property area, and which one to open
// when the URL does not say. See .agents/docs/HUB_SETUP_PLAN.md.
//
// The property is always in the URL (/e/{slug}/hub/p/{propertyId}/…) — this module only
// answers "which one by default". It never decides access on its own: every property page
// re-checks through its layout, and every property API through requirePropertySetup().

// Remembers the last property opened in the Hub, per browser. Deliberately NOT the
// dashboard's `current_property_id` cookie: that one is the session's working property
// (End-of-Day sign-out is keyed on it), and configuring a property must never change
// where somebody is working.
export const HUB_PROPERTY_COOKIE = "hub_property_id"

export type HubProperty = {
  id: string
  name: string
  code: string
  bannerColor: string | null
}

export async function listHubProperties(ctx: AuthContext): Promise<HubProperty[]> {
  const properties = await prisma.property.findMany({
    where: {
      enterpriseId: ctx.enterpriseId,
      status: "ACTIVE",
      ...(ctx.scope === "PROPERTY" ? { id: ctx.propertyId ?? "" } : {}),
    },
    select: { id: true, name: true, code: true, bannerColor: true, enterpriseId: true },
    orderBy: { createdAt: "asc" },
  })
  return properties
    .filter((p) => canSetUpProperty(ctx, p))
    .map(({ id, name, code, bannerColor }) => ({ id, name, code, bannerColor }))
}

// Last property opened in the Hub if still allowed, else the one the user is working in,
// else the first they may open. Null when there is none.
export async function resolveHubPropertyId(ctx: AuthContext, allowed?: HubProperty[]): Promise<string | null> {
  const properties = allowed ?? (await listHubProperties(ctx))
  if (properties.length === 0) return null
  const ids = new Set(properties.map((p) => p.id))

  const remembered = (await cookies()).get(HUB_PROPERTY_COOKIE)?.value
  if (remembered && ids.has(remembered)) return remembered
  if (ctx.sessionPropertyId && ids.has(ctx.sessionPropertyId)) return ctx.sessionPropertyId
  return properties[0].id
}

// The sellable add-ons this enterprise holds that have setup pages (Spa, Excursions).
export async function loadHubAddons(enterpriseId: string): Promise<Set<HubAddon>> {
  const rows = await prisma.enterpriseAddonAccess.findMany({
    where: { enterpriseId, enabled: true, module: { in: ["SPA", "EXCURSIONS"] } },
    select: { module: true },
  })
  return new Set(rows.map((r) => r.module as HubAddon))
}
