import { requireSession, requireHubAccess, requirePermission, hasPermission } from "@/lib/scope"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InfoHint } from "@/components/ui/info-hint"
import { WebsiteApiKeys } from "@/components/hub/website-api-keys"
import { WebsitePropertySettings } from "@/components/hub/website-property-settings"
import { WebsiteActivitySettings } from "@/components/hub/website-activity-settings"
import { enabledActivityModules } from "@/lib/website-api/scopes"

// Booking API (was "Website API") — API keys for each property's own brand website, and
// what that website may show and sell: rooms, and — when the enterprise has the add-ons —
// excursions and spa. See .agents/docs/WEBSITE_API_PLAN.md,
// .agents/docs/BOOKING_API_ADDONS_PLAN.md and docs/WEBSITE_API.md.
//
// Configuration, not operation (the Hub's rule): a key is an enterprise-level credential
// covering one or more properties, and the per-property settings take an explicit
// property rather than an ambient "current" one.
export default async function HubWebsitePage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)
  requirePermission(ctx, "INTEGRATIONS", "view")

  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")
  const canCreate = hasPermission(ctx, "INTEGRATIONS", "create")
  const canRevoke = hasPermission(ctx, "INTEGRATIONS", "delete")
  // The Excursions & Spa tab only exists for an enterprise that has either add-on.
  const hasActivityAddons = (await enabledActivityModules(ctx.enterpriseId)).size > 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          Booking API
          <InfoHint label="Booking API">
            Lets each property&apos;s own website show live availability and prices and take
            bookings straight into this system — rooms, and excursions and spa where you have
            them. Create a key per website, choose which properties and what it may use, and
            set what each property sells online.
          </InfoHint>
        </h2>
        <p className="mt-1 text-muted-foreground">
          Keys for your brand websites, and what each property shows and sells online.
        </p>
      </div>

      <Tabs defaultValue="keys" className="space-y-4">
        <TabsList>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          {hasActivityAddons && <TabsTrigger value="activities">Excursions &amp; Spa</TabsTrigger>}
        </TabsList>
        <TabsContent value="keys">
          <WebsiteApiKeys canCreate={canCreate} canManage={canManage} canRevoke={canRevoke} />
        </TabsContent>
        <TabsContent value="properties">
          <WebsitePropertySettings canManage={canManage} />
        </TabsContent>
        {hasActivityAddons && (
          <TabsContent value="activities">
            <WebsiteActivitySettings canManage={canManage} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
