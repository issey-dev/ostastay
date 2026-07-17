import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";

const GENERIC_ERROR = "Incorrect enterprise code, email, or password.";

export async function POST(request: Request) {
  try {
    const { email, password, enterpriseSlug } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { enterprise: { select: { slug: true } } }
    });

    // A wrong enterprise code, a wrong email, and a wrong password all produce the
    // identical generic error — no enumeration of which one was actually wrong.
    if (!user || !user.isActive) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    if (enterpriseSlug) {
      const enterprise = await prisma.enterprise.findUnique({ where: { slug: enterpriseSlug.toLowerCase() } });
      if (!enterprise || enterprise.id !== user.enterpriseId) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
      }
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    await createSession(user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`
      },
      enterpriseSlug: user.enterprise.slug
    });

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
