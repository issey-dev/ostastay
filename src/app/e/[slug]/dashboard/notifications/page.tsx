import { PageHeader } from "@/components/ui/page-header"
import { NotificationCenter } from "@/components/notifications/notification-center"

// Everything the signed-in person has received, and their choices (bell and phone, per kind).
// No module permission: the data is the caller's own (see src/lib/notifications/inbox.ts).
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" hint="Everything you have been notified about, and what you want to be told. Phone notifications are set up per device." />
      <NotificationCenter initialTab={tab === "settings" ? "settings" : "inbox"} />
    </div>
  )
}
