import { PageHeader } from "@/components/ui/page-header"
import { NotificationCenter } from "@/components/notifications/notification-center"

// Everything the signed-in platform admin has been notified about, and their choices. The
// same list and settings as a customer's, plus the platform kinds (approvals, licences,
// billing, channels). The data is the caller's own; the console layout already limits this
// shell to Uppsolut staff.
export default async function OstaNotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        tabTitle="Notifications · Osta"
        description="What needs your attention, and what you want to be told."
        hint="These come from the same list as Today's Needs action. Phone notifications are set up per device."
      />
      <NotificationCenter initialTab={tab === "settings" ? "settings" : "inbox"} />
    </div>
  )
}
