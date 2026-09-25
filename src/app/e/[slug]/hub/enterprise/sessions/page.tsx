import { requireSession, requireEnterpriseHub, requirePermission, hasPermission } from "@/lib/scope"
import { ActiveSessions } from "@/components/hub/active-sessions"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ENTERPRISE_NAV, navItem } from "@/components/hub/hub-nav"

// Active sessions — who is signed in, for how long, and the ability to sign them out.
//
// None of this existed before 2026-08-04: sessions were stateless JWTs with no server-side
// record, so there was nothing to list and nothing to revoke. See src/lib/session-store.ts.
export default async function HubSessionsPage() {
  const ctx = await requireSession()
  requireEnterpriseHub(ctx)
  requirePermission(ctx, "USERS", "view")

  // Viewing who is signed in and ending someone's session are different acts.
  const canTerminate = hasPermission(ctx, "USERS", "update")
  const item = navItem(ENTERPRISE_NAV, "sessions")

  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="enterprise"
        hint="A session ends when the person signs out, when an administrator ends it here, after the property's idle timeout, or when End of Day rolls the business date. Set the idle timeout per property in Controls."
      />

      <ActiveSessions canTerminate={canTerminate} />
    </div>
  )
}
