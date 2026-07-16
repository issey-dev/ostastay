import { redirect } from "next/navigation";
import { requireSession } from "@/lib/scope";

export default async function DashboardRoot() {
  const ctx = await requireSession().catch(() => null);
  if (!ctx) {
    redirect("/login");
  }

  // Redirect users to their specific primary workspace based on permissions — a role
  // with no Front Desk access (e.g. Housekeeping) lands on their own module instead of
  // the general front-office view.
  const canViewFrontDesk = ctx.permissions.get("FRONT_DESK")?.canView ?? false;
  redirect(canViewFrontDesk ? "/dashboard/front-office" : "/dashboard/inventory");
}
