import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import {
  AgentAuthError,
  invitePortalLogin,
  listPortalLogins,
  resetPortalLogin,
  setPortalLoginStatus,
} from "@/lib/agent-api/auth";

// Portal logins on a Source profile (Agent Portal plan A-25, Phase 5). GET lists them; POST:
//   { action: "invite", email, name? }        → { user, token, link } (the link is shown once)
//   { action: "suspend" | "reactivate", id }
//   { action: "reset", id }                   → { token, link, kind }
// Changing anything needs PROFILES update and "Manage portal logins" ("profiles.portalLogins").
export async function GET(_request: Request, { params }: { params: Promise<{ upid: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "view");
    const { upid } = await params;
    return NextResponse.json(await listPortalLogins(ctx, upid));
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ upid: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : "";
    switch (body?.action) {
      case "invite":
        return NextResponse.json(await invitePortalLogin(ctx, upid, { email: body.email, name: body.name }), { status: 201 });
      case "suspend":
        await setPortalLoginStatus(ctx, upid, id, "SUSPENDED");
        return NextResponse.json({ ok: true });
      case "reactivate":
        await setPortalLoginStatus(ctx, upid, id, "ACTIVE");
        return NextResponse.json({ ok: true });
      case "reset":
        return NextResponse.json(await resetPortalLogin(ctx, upid, id));
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
