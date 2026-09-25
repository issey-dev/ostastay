import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WebsitePropertySettings } from "@/components/hub/website-property-settings"
import { WebsiteActivitySettings } from "@/components/hub/website-activity-settings"
import { WebsiteOnlineBookings } from "@/components/hub/website-online-bookings"
import { enabledActivityModules } from "@/lib/website-api/scopes"

// What this property's brand website shows and sells through the Booking API — rooms, and
// excursions and spa when the enterprise has the add-ons — and every booking it made. The
// API keys themselves are enterprise credentials (Hub > Enterprise > Booking API).
// See .agents/docs/HUB_SETUP_PLAN.md, Phase 4.
export default async function HubPropertyOnlineBookingPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { ctx, property, item, canEdit } = await propertyPage(params, "online-booking")
  const activityModules = [...(await enabledActivityModules(ctx.enterpriseId))].sort()
  const hasActivityAddons = activityModules.length > 0
  const canManage = canEdit("update")

  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="property"
        hint="What this property's own website shows and sells through the Booking API, and the bookings it has made. The website's API key is created by an enterprise administrator."
      />
      <HubSetupNotice title={item.title} />
      <Tabs defaultValue="website" className="space-y-4">
        <TabsList>
          <TabsTrigger value="website">Website</TabsTrigger>
          {hasActivityAddons && <TabsTrigger value="activities">Excursions &amp; Spa</TabsTrigger>}
          <TabsTrigger value="bookings">Online bookings</TabsTrigger>
        </TabsList>
        <TabsContent value="website">
          <WebsitePropertySettings propertyId={property.id} canManage={canManage} />
        </TabsContent>
        {hasActivityAddons && (
          <TabsContent value="activities">
            <WebsiteActivitySettings propertyId={property.id} canManage={canManage} />
          </TabsContent>
        )}
        <TabsContent value="bookings">
          <WebsiteOnlineBookings propertyId={property.id} modules={["ROOMS", ...activityModules]} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
