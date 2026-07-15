import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function DashboardRoot() {
  const session = await getSession();
  
  if (!session) {
    redirect("/login");
  }

  // Redirect users to their specific primary workspace based on role
  if (session.role === "HOUSEKEEPING") {
    redirect("/dashboard/inventory");
  } else {
    redirect("/dashboard/front-office");
  }
}
