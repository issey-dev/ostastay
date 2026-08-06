import { NextResponse } from "next/server";
import { requireSession, toErrorResponse } from "@/lib/scope";

// Called by IdleSessionWatch exactly once, at the moment its own local inactivity clock
// thinks the property's idle window has elapsed in this tab — never on a fixed schedule,
// so a tab that stays genuinely idle costs nothing until then, and a property with no
// timeout set (sessionIdleMinutes = 0, the default) never calls this at all.
//
// A plain requireSession(): if this session has really gone untouched past the idle
// window, that throws and revokes it here, same as it would on any other route. If a
// different tab of the same session has been active in the meantime, this just succeeds
// — the session, not the tab, is what the idle timeout is measured against.
export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
