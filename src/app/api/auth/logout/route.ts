import { NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAuthActivity } from "@/lib/activity-log";

export async function POST() {
  // Resolve who is signing out before the cookie is gone — best-effort only, an
  // expired/absent session still logs out cleanly without an activity row.
  const session = await getSession();
  await destroySession();

  if (session?.id && typeof session.id === "string") {
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { email: true, firstName: true, lastName: true, enterpriseId: true },
    });
    if (user) {
      await logAuthActivity({
        action: "LOGOUT",
        email: user.email,
        userId: session.id,
        userName: `${user.firstName} ${user.lastName}`,
        enterpriseId: user.enterpriseId,
        description: "Signed out",
      });
    }
  }

  return NextResponse.json({ success: true });
}
