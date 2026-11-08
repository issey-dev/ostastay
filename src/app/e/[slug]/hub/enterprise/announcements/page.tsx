import { enterprisePage } from "@/lib/hub-page"
import { hasPermission } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { AnnouncementsManager } from "@/components/hub/announcements-manager"

// Announcements — a message from an administrator to everyone, or to one property. Delivered
// as a notification the bell cannot mute (NOTIFICATIONS_PLAN.md section 4).
export default async function HubAnnouncementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { ctx, item } = await enterprisePage(params, "announcements")
  const properties = await prisma.property.findMany({
    where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="enterprise"
        hint="Everyone you send to sees it in their bell, and on their phone if they have turned that on. It cannot be switched off in the bell. Do not put guest names or amounts in it."
      />
      <AnnouncementsManager properties={properties} canSend={hasPermission(ctx, "CONTROLS", "update") && !ctx.isActingAsSupport} />
    </div>
  )
}
