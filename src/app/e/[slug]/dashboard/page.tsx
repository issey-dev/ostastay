import { redirect } from "next/navigation";
import { requireSession, hasHubAccess, hasAnyPropertyModule } from "@/lib/scope";

export default async function DashboardRoot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession().catch(() => null);
  if (!ctx) {
    redirect("/login");
  }

  // A Hub-only administrator (enterprise-scoped, holding only Hub modules — see
  // .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md) has no property-operational access at all,
  // so every branch below would land them on a page they cannot view. Send them to the
  // Hub instead. Checked first, and only when they genuinely have no property module, so
  // a normal admin — who holds both — still lands on the front office as before.
  if (!hasAnyPropertyModule(ctx) && hasHubAccess(ctx)) {
    redirect(`/e/${slug}/hub`);
  }

  // Redirect users to their specific primary workspace based on permissions — a role
  // with no Front Desk access (e.g. Housekeeping) lands on their own module instead of
  // the general front-office view.
  const canViewFrontDesk = ctx.permissions.get("FRONT_DESK")?.canView ?? false;
  redirect(canViewFrontDesk ? `/e/${slug}/dashboard/front-office` : `/e/${slug}/dashboard/inventory`);
}
