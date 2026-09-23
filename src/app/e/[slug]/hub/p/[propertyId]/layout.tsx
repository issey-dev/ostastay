import { redirect } from "next/navigation"
import { requireSession, canSetUpProperty } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { HUB_PROPERTY_COOKIE, listHubProperties } from "@/lib/hub-properties"
import { HubPropertyBand } from "@/components/hub/hub-property-band"

// The Hub's PROPERTY area — one property's setup (see .agents/docs/HUB_SETUP_PLAN.md).
//
// The property comes from the URL and nowhere else. This layout is the page-side gate:
// the property must belong to the caller's enterprise, be ACTIVE, and — for a
// single-property user — be their own. Anything else goes back to /hub/p, which resolves
// a property they may open. Every API route behind these pages re-checks through
// requirePropertySetup(); this protects the pages only.
//
// Still no PropertyProvider (the Hub layout's rule): pages read `propertyId` from params
// and hand it to their components explicitly.
export default async function HubPropertyLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string; propertyId: string }>
}) {
  const { slug, propertyId } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, name: true, code: true, bannerColor: true, enterpriseId: true, status: true },
  })
  if (!property || property.status !== "ACTIVE" || !canSetUpProperty(ctx, property)) {
    redirect(`/e/${slug}/hub/p`)
  }

  const properties = await listHubProperties(ctx)

  return (
    <>
      <HubPropertyBand
        slug={slug}
        property={{ id: property.id, name: property.name, code: property.code, bannerColor: property.bannerColor }}
        properties={properties}
        cookieName={HUB_PROPERTY_COOKIE}
      />
      {children}
    </>
  )
}
