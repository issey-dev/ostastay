import { redirect } from "next/navigation";
import { requireSession } from "@/lib/scope";

export default async function DashboardRoot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession().catch(() => null);
  if (!ctx) {
    redirect("/login");
  }

  // Redirect users to their specific primary workspace based on permissions — a role
  // with no Front Desk access (e.g. Housekeeping) lands on their own module instead of
  // the general front-office view.
  const canViewFrontDesk = ctx.permissions.get("FRONT_DESK")?.canView ?? false;
  redirect(canViewFrontDesk ? `/e/${slug}/dashboard/front-office` : `/e/${slug}/dashboard/inventory`);
}
