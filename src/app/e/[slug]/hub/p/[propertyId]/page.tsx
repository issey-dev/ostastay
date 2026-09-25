import Link from "next/link"
import { requireSession, hasPermission } from "@/lib/scope"
import { PROPERTY_NAV, propertyHref, visibleKeys } from "@/components/hub/hub-nav"
import { loadHubAddons } from "@/lib/hub-properties"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronRight } from "@/components/icons"

// A property's setup landing page: every section of this property the user may open.
// The band above (from the layout) already names the property.
export default async function HubPropertyHomePage({
  params,
}: {
  params: Promise<{ slug: string; propertyId: string }>
}) {
  const { slug, propertyId } = await params
  const ctx = await requireSession()
  const keys = visibleKeys(PROPERTY_NAV, (m) => hasPermission(ctx, m, "view"), await loadHubAddons(ctx.enterpriseId))
  // Controls' own sections: not sub-pages, and not the Channel Manager (its own sidebar entry).
  const sections = PROPERTY_NAV.filter((item) => item.path !== "" && !item.child && !item.ownEntry && keys.includes(item.key))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Controls</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything on these pages applies to this property only.
        </p>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No setup sections are available to you for this property.
        </div>
      ) : (
        <>
        {/* Phones: one compact list (icon · title · chevron) instead of 14 tall cards. */}
        <nav aria-label="Setup sections" className="overflow-hidden rounded-2xl bg-card shadow-elevation-1 ring-1 ring-foreground/5 sm:hidden">
          <ul className="divide-y divide-border">
            {sections.map((item) => (
              <li key={item.key}>
                <Link
                  href={propertyHref(slug, propertyId, item)}
                  className="flex min-h-12 items-center gap-3 px-4 py-3 text-sm font-medium text-foreground outline-hidden focus-visible:bg-muted active:bg-muted"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-4 max-sm:hidden sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((item) => (
            <Link
              key={item.key}
              href={propertyHref(slug, propertyId, item)}
              className="rounded-lg outline-hidden focus-visible:ring-2 ring-ring"
            >
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    {item.title}
                  </CardTitle>
                  {item.description && <CardDescription>{item.description}</CardDescription>}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
        </>
      )}
    </div>
  )
}
