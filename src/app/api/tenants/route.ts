import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slug";

// TODO(Phase 1): this becomes /api/enterprises with real requireSession/requirePermission
// checks (only an Osta/INTERNAL user should be able to list/create enterprises) — see
// the approved plan. Left at this path for now since nothing in the app currently calls it.
export async function GET() {
  try {
    const enterprises = await prisma.enterprise.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(enterprises);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch enterprises" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: "Enterprise name is required" }, { status: 400 });
    }

    const baseSlug = slugify(body.name);
    let slug = baseSlug;
    for (let attempt = 1; await prisma.enterprise.findUnique({ where: { slug } }); attempt++) {
      slug = `${baseSlug}-${attempt}`;
    }

    const newEnterprise = await prisma.enterprise.create({
      data: {
        name: body.name,
        slug,
      },
    });

    return NextResponse.json(newEnterprise, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create enterprise" }, { status: 500 });
  }
}
