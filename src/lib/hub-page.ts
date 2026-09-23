import { redirect } from "next/navigation"
import { requireSession, hasPermission, hasEnterpriseHubAccess } from "@/lib/scope"
import { ENTERPRISE_NAV, PROPERTY_NAV, navItem } from "@/components/hub/hub-nav"
import { loadHubAddons } from "@/lib/hub-properties"
import { loadHubPropertyDetail } from "@/lib/hub-property-detail"

// The one guard every Hub setup page starts with — so "may this user open this page?" is
// decided from the same nav entry that decides whether the page is in their sidebar, and
// no page can drift from its menu item. See .agents/docs/HUB_SETUP_PLAN.md.
//
// Pages only: every API route behind them still gates itself with requirePropertySetup()
// or requireEnterpriseHub().

export async function propertyPage(params: Promise<{ slug: string; propertyId: string }>, key: string) {
  const { slug, propertyId } = await params
  const ctx = await requireSession()
  const item = navItem(PROPERTY_NAV, key)
  const home = `/e/${slug}/hub/p/${propertyId}`

  // The property layout has already checked this property is one the user may set up.
  if (!item.modules.some((m) => hasPermission(ctx, m, "view"))) redirect(home)
  if (item.addon && !(await loadHubAddons(ctx.enterpriseId)).has(item.addon)) redirect(home)

  const property = await loadHubPropertyDetail(propertyId)
  if (!property) redirect(`/e/${slug}/hub/p`)

  const canEdit = (action: "create" | "update" | "delete" = "update") =>
    item.modules.some((m) => hasPermission(ctx, m, action))

  return { ctx, slug, propertyId, property, item, canEdit }
}

export async function enterprisePage(params: Promise<{ slug: string }>, key: string) {
  const { slug } = await params
  const ctx = await requireSession()
  const item = navItem(ENTERPRISE_NAV, key)
  if (!hasEnterpriseHubAccess(ctx) || !item.modules.some((m) => hasPermission(ctx, m, "view"))) {
    redirect(`/e/${slug}/hub`)
  }
  return { ctx, slug, item }
}
