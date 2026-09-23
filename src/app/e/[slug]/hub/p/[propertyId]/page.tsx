import Link from "next/link"
import { requireSession, hasPermission } from "@/lib/scope"
import { PROPERTY_NAV, propertyHref } from "@/components/hub/hub-nav"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// A property's setup landing page: every section of this property the user may open.
// The band above (from the layout) already names the property.
export default async function HubPropertyHomePage({
  params,
}: {
  params: Promise<{ slug: string; propertyId: string }>
}) {
  const { slug, propertyId } = await params
  const ctx = await requireSession()
  const sections = PROPERTY_NAV.filter(
    (item) => item.path !== "" && item.modules.some((m) => hasPermission(ctx, m, "view"))
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything on these pages applies to this property only.
        </p>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No setup sections are available to you for this property.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
      )}
    </div>
  )
}
