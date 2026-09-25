import { requireSession, requireEnterpriseHub, requirePermission } from "@/lib/scope"
import { UsersRolesManager } from "@/components/controls/users-roles-manager"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ENTERPRISE_NAV, navItem } from "@/components/hub/hub-nav"
import { Button } from "@/components/ui/button"
import { FileText } from "@/components/icons"

// People — staff administration, moved out of Controls on 2026-08-04.
//
// Identity is enterprise-wide: who exists, what they may do, and where they work. Keeping
// it in a property's Controls made it look like a per-property setting, which it never
// was. Being a Hub screen also means only ENTERPRISE-scoped users reach it — the owner's
// decision that staff administration belongs to enterprise admins.
//
// The operational "list people I can assign work to" lookup deliberately does NOT live
// behind this gate; see /api/staff.
export default async function HubPeoplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireSession()
  // Re-asserted here rather than relying on the layout, so the page is honest on its own.
  requireEnterpriseHub(ctx)
  requirePermission(ctx, "USERS", "view")
  const item = navItem(ENTERPRISE_NAV, "people")

  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="enterprise"
        hint="Everyone who can sign in to this enterprise, the roles that decide what they see, and the work location and post they hold. Access is the combination of every role a person is given."
      >
        {/* The permission matrix report is a wide landscape print document, opened in its
            own tab to print (a full load on purpose) — desktop only. */}
        <div className="max-md:hidden">
          <Button variant="outline" nativeButton={false} render={<a href={`/e/${slug}/hub/enterprise/permission-matrix`} target="_blank" rel="noreferrer" />}>
            <FileText className="mr-2 h-4 w-4" /> Permission matrix report
          </Button>
        </div>
      </HubPageHeader>

      {/* Enterprise-scoped by definition — a property-scoped user can't reach the Hub, so
          the manager's property-lock branch never engages here. */}
      <UsersRolesManager actorScope="ENTERPRISE" actorPropertyId={null} />
    </div>
  )
}
