import { HubPageHeader } from "@/components/hub/hub-page-header"
import { NotificationCenter } from "@/components/notifications/notification-center"
import { NotificationBell } from "@/components/icons"

// The Hub's copy of the notifications page — same list and settings as the dashboard's, for
// people (Hub-only administrators) who have no dashboard to open it from.
export default async function HubNotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  return (
    <div className="space-y-6">
      <HubPageHeader title="Notifications" icon={NotificationBell} description="Everything you have been notified about, and what you want to be told." />
      <NotificationCenter initialTab={tab === "settings" ? "settings" : "inbox"} />
    </div>
  )
}
