import { redirect } from "next/navigation";
import { requireSession, hasHubAccess, hasAnyPropertyModule, hasPermission } from "@/lib/scope";
import { NAV_GROUPS } from "@/components/app-sidebar-nav.config";
import { EmptyState } from "@/components/ui/empty-state";
import { Lock } from "@/components/icons";

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

  // Everyone who can open the Operations Dashboard lands there. Each of its tiles is
  // still gated on its own module's canView, so a Housekeeping-only user sees the
  // housekeeping tiles and nothing else rather than a page they aren't allowed to read.
  if (hasPermission(ctx, "DASHBOARD", "view")) {
    redirect(`/e/${slug}/dashboard/overview`);
  }

  // No DASHBOARD: send them to the first thing their sidebar will actually show. Read
  // from the nav config rather than a second hand-written order, so this can never send
  // someone to a page their own sidebar doesn't offer.
  const first = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.module && hasPermission(ctx, i.module, "view"));
  if (first) redirect(`/e/${slug}${first.url}`);

  // Nothing in the sidebar is open to them. The old fallback (/dashboard/profile) doesn't
  // exist, and every real page bounces a user without its module back here, so no redirect
  // is safe — the login page sends a signed-in browser straight back to /dashboard. Hub
  // access is the one other place they can use; otherwise say so, inside the normal shell
  // (its account menu can still sign out).
  if (hasHubAccess(ctx)) redirect(`/e/${slug}/hub`);
  return (
    <EmptyState
      icon={Lock}
      title="No screens available"
      description="Your role doesn't include any screens for this property yet. Ask your administrator for access."
      className="py-24"
    />
  );
}
