import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, requirePropertyScope, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { saveLogo, deleteLogoFile, LogoValidationError } from "@/lib/property-logo";

// Upload (POST, multipart "logo") or remove (DELETE) a property's logo — Hub › the property
// › General. The browser has already cropped it to 3:2 and exported 900 × 600 PNG; the
// server verifies that (src/lib/property-logo.ts) and stores it. The same gate as editing
// the property's profile (PUT /api/properties/[id]).
async function loadProperty(id: string) {
  const ctx = await requireSession();
  requirePermission(ctx, "CONTROLS", "update");
  const property = await prisma.property.findUnique({ where: { id }, select: { id: true, name: true, enterpriseId: true, logoUrl: true } });
  if (!property || property.enterpriseId !== ctx.enterpriseId) throw new ForbiddenError("Property not found");
  requirePropertyScope(ctx, id);
  return { ctx, property };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx, property } = await loadProperty(id);
    const form = await request.formData().catch(() => null);
    const file = form?.get("logo");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a logo to upload." }, { status: 400 });

    const logoUrl = await saveLogo(id, Buffer.from(await file.arrayBuffer()));
    await prisma.property.update({ where: { id }, data: { logoUrl } });
    await deleteLogoFile(property.logoUrl);
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "Property", entityId: id, description: `Uploaded a new logo for ${property.name}` });
    return NextResponse.json({ logoUrl });
  } catch (error) {
    if (error instanceof LogoValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx, property } = await loadProperty(id);
    await prisma.property.update({ where: { id }, data: { logoUrl: null } });
    await deleteLogoFile(property.logoUrl);
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "Property", entityId: id, description: `Removed the logo of ${property.name}` });
    return NextResponse.json({ logoUrl: null });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
