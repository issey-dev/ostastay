import { requireSession, requireHubAccess, hasPermission } from "@/lib/scope"
import { InboundBookingsManager } from "@/components/hub/inbound-bookings-manager"

// Inbound bookings — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Phase 1: received bookings are recorded and problems surfaced, but they are not turned
// into Reservations automatically. See the note on ChannelInboundBooking in schema.prisma.
export default async function ChannelManagerBookingsPage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)

  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Inbound Bookings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Bookings received from the booking channels, with anything that needs attention flagged.
        </p>
      </div>

      <InboundBookingsManager canManage={canManage} />
    </div>
  )
}
