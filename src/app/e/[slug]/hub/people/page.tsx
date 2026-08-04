import { requireSession, requireHubAccess, requirePermission } from "@/lib/scope"
import { UsersRolesManager } from "@/components/controls/users-roles-manager"
import { InfoHint } from "@/components/ui/info-hint"
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
  requireHubAccess(ctx)
  requirePermission(ctx, "USERS", "view")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          People
          <InfoHint label="People">
            Everyone who can sign in to this enterprise, the roles that decide what they
            see, and the work location and post they hold. Access is the combination of
            every role a person is given.
          </InfoHint>
        </h2>
        <p className="mt-1 text-muted-foreground">
          Staff accounts, roles and work locations across the enterprise.
        </p>
      </div>

      <div>
        <Button variant="outline" render={<a href={`/e/${slug}/hub/permission-matrix`} target="_blank" rel="noreferrer" />}>
          <FileText className="mr-2 h-4 w-4" /> Permission matrix report
        </Button>
      </div>

      {/* Enterprise-scoped by definition — a property-scoped user can't reach the Hub, so
          the manager's property-lock branch never engages here. */}
      <UsersRolesManager actorScope="ENTERPRISE" actorPropertyId={null} />
    </div>
  )
}
