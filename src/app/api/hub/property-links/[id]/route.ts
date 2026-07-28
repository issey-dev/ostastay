import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import {
  setRoomTypeMapping,
  setRatePlanMapping,
  setSyncEnabled,
  deletePropertyLink,
  assertLinkInEnterprise,
} from "@/lib/channels/sharing";

// Mapping edits and the sharing switch for one property link.
//
// One PATCH handles three distinct edits (room-type mapping, rate-plan mapping, the sharing
// toggle) because they are all small mutations of the same aggregate and the UI saves them
// one at a time. The action is chosen by which fields are present.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const link = await assertLinkInEnterprise(id, ctx.enterpriseId);
    const body = await request.json().catch(() => null);

    if (typeof body?.roomTypeId === "string") {
      await setRoomTypeMapping({
        enterpriseId: ctx.enterpriseId,
        linkId: id,
        roomTypeId: body.roomTypeId,
        externalRoomId: typeof body.externalRoomId === "string" ? body.externalRoomId : "",
        shared: typeof body.shared === "boolean" ? body.shared : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    if (typeof body?.ratePlanId === "string") {
      await setRatePlanMapping({
        enterpriseId: ctx.enterpriseId,
        linkId: id,
        ratePlanId: body.ratePlanId,
        externalRateId: typeof body.externalRateId === "string" ? body.externalRateId : "",
      });
      return NextResponse.json({ ok: true });
    }

    if (typeof body?.syncEnabled === "boolean") {
      // setSyncEnabled refuses to turn sharing ON while anything required is unmapped —
      // that ForbiddenError becomes a 403 with the real reason, which is what the operator
      // needs to see.
      await setSyncEnabled({ enterpriseId: ctx.enterpriseId, linkId: id, enabled: body.syncEnabled });
      await logActivity({
        ctx,
        module: "INTEGRATIONS",
        action: "UPDATE",
        description: `${body.syncEnabled ? "Enabled" : "Disabled"} channel-manager sharing for a property`,
        entityType: "ChannelPropertyLink",
        entityId: id,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "That channel-manager id is already mapped to something else" },
        { status: 409 }
      );
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "delete");

    await deletePropertyLink(ctx.enterpriseId, id);

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "DELETE",
      description: "Unlinked a property from the channel manager",
      entityType: "ChannelPropertyLink",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
