import { NextResponse } from "next/server";

// Everything that ESTABLISHES or RESHAPES the Beds24 link is an OSTA-LEVEL action, not a
// tenant one (app-owner decision, 2026-08-03). Under the master-account topology the
// invite code belongs to the app owner's own Beds24 account and every tenant drains one
// shared API credit pool, so a tenant must not be able to:
//   - re-authorize with a new invite code (they have none, and it would replace a
//     credential the platform owns),
//   - delete the connection,
//   - change the rate-limit self-throttle floor (it protects a pool shared with every
//     other tenant), or the poll lookback window.
//
// Refused here rather than only hidden in the Hub UI — a hidden button is not a control.
// The platform-side equivalents live under /api/osta/channels/connections/[id].
//
// What the Hub KEEPS: a read-only view of connection health (GET /api/hub/connections),
// the on-demand health check (POST .../test — diagnostics, and the keep-alive), mapping,
// inbound bookings, and its own exchange logs.
const OSTA_MANAGED =
  "Channel-manager connections are set up and maintained by Osta. Contact Osta to change or remove this enterprise's channel manager.";

export async function PATCH() {
  return NextResponse.json({ error: OSTA_MANAGED }, { status: 403 });
}

export async function DELETE() {
  return NextResponse.json({ error: OSTA_MANAGED }, { status: 403 });
}
