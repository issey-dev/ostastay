import { redirect } from "next/navigation";
import { requireSession, hasHubAccess, hasAnyPropertyModule } from "@/lib/scope";

export default async function DashboardRoot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession().catch(() => null);
  if (!ctx) {
    redirect("/api/auth/session-expired");
  }

  // A Hub-only administrator (enterprise-scoped, holding only Hub modules — see
  // .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md) has no property-operational access at all,
  // so every branch below would land them on a page they cannot view. Send them to the
  // Hub instead. Checked first, and only when they genuinely have no property module, so
  // a normal admin — who holds both — still lands on the front office as before.
  if (!hasAnyPropertyModule(ctx) && hasHubAccess(ctx)) {
    redirect(`/e/${slug}/hub`);
  }

  // Everyone else lands on the Operations Dashboard. It is safe as a universal landing
  // page precisely because it has no single owning module: every tile is gated on its
  // own module's canView, so a Housekeeping-only user sees the housekeeping tiles and
  // nothing else rather than a page they aren't allowed to read. (It used to route by
  // FRONT_DESK to either the front office or the orphaned /inventory route.)
  redirect(`/e/${slug}/dashboard/overview`);
}
