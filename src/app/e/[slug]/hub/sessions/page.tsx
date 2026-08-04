import { requireSession, requireHubAccess, requirePermission, hasPermission } from "@/lib/scope"
import { ActiveSessions } from "@/components/hub/active-sessions"
import { InfoHint } from "@/components/ui/info-hint"

// Active sessions — who is signed in, for how long, and the ability to sign them out.
//
// None of this existed before 2026-08-04: sessions were stateless JWTs with no server-side
// record, so there was nothing to list and nothing to revoke. See src/lib/session-store.ts.
export default async function HubSessionsPage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)
  requirePermission(ctx, "USERS", "view")

  // Viewing who is signed in and ending someone's session are different acts.
  const canTerminate = hasPermission(ctx, "USERS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          Sessions
          <InfoHint label="Sessions">
            A session ends when the person signs out, when an administrator ends it here,
            after the property&apos;s idle timeout, or when End of Day rolls the business
            date. Set the idle timeout per property in Controls.
          </InfoHint>
        </h2>
        <p className="mt-1 text-muted-foreground">
          Everyone currently signed in across the enterprise.
        </p>
      </div>

      <ActiveSessions canTerminate={canTerminate} />
    </div>
  )
}
