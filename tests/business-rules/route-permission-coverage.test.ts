import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Agent Portal plan §10 / Phase 0a: every API route handler must be gated by a permission
// check (a module action, a capability, or one of the shared gate helpers that wrap one),
// or be listed below with the reason it is deliberately open. A new route that only checks
// the session fails this test, so the "signed in is enough" gap cannot reopen.

const API_ROOT = join(process.cwd(), "src", "app", "api");

// Calls that are, or wrap, a permission check. A helper belongs here only if it calls
// requirePermission / hasPermission (or an equivalent) itself.
const GATES = [
  "requirePermission",
  "requireAnyPermission",
  "hasPermission",
  "requireCapability",
  "requireEnterpriseHub",
  "requirePropertySetup",
  "greenTaxContext", // src/app/api/hub/green-tax/_shared.ts
  "authorizeConnection", // src/lib/channels/hub-access.ts
  "authorizeLink",
  "authorizePropertyParam",
  "opsGate", // src/lib/transport/http.ts
  "configGate",
  "catalogueGate",
  "websiteRoute", // Booking API: API key + scope
  "agentRoute", // Agent API: API key (AGENT scope) + agent session
  "runReport", // src/lib/reports/run.ts → REPORTS view
];

// Routes that are open on purpose. Path relative to src/app/api, forward slashes.
const ALLOW: Record<string, string> = {
  "auth/change-password/route.ts": "acts on the signed-in user's own password",
  "auth/login/route.ts": "sign-in itself",
  "auth/logout/route.ts": "sign-out itself",
  "auth/seed/route.ts": "development seed; refuses in production",
  "auth/session-expired/route.ts": "clears an expired cookie",
  "channels/webhook/[token]/route.ts": "inbound channel webhook, authenticated by its secret token",
  "eregistration/[token]/route.ts": "guest-facing, authenticated by the eRegistration token",
  "eregistration/[token]/slots/[slotId]/route.ts": "guest-facing, eRegistration token",
  "eregistration/[token]/slots/[slotId]/finalize/route.ts": "guest-facing, eRegistration token",
  "eregistration/[token]/slots/[slotId]/photo/route.ts": "guest-facing, eRegistration token",
  "eregistration/[token]/slots/[slotId]/scan-document/route.ts": "guest-facing, eRegistration token",
  "jobs/run/route.ts": "cron endpoint, guarded by the shared cron secret",
  "logos/[file]/route.ts": "public property logos (shown on guest documents)",
  "notifications/route.ts": "the signed-in user's own inbox",
  "notifications/read/route.ts": "the signed-in user's own inbox",
  "notifications/preferences/route.ts": "the signed-in user's own preferences",
  "notifications/push/route.ts": "the signed-in user's own devices",
  "notifications/install-offer/route.ts": "the signed-in user's own device prompt",
  "session/current-property/route.ts": "switches the user's own working property (checked against scope)",
  "session/eod-status/route.ts": "the user's own session state",
  "session/idle-check/route.ts": "the user's own session state",
  "support-access/enter/[id]/route.ts": "Osta-internal users only (ctx.isInternal) with an approved grant",
  "support-access/exit/route.ts": "leaves the caller's own support session",
};

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routes(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(API_ROOT, f).split(sep).join("/");

describe("API route permission coverage", () => {
  const files = routes(API_ROOT);

  it("finds the API routes", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every route is gated or allow-listed with a reason", () => {
    const pattern = new RegExp(`\\b(${GATES.join("|")})\\b`);
    const ungated = files
      .filter((f) => !pattern.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((r) => !ALLOW[r]);
    expect(ungated, `Routes with no permission check:\n${ungated.join("\n")}`).toEqual([]);
  });

  it("the allow-list has no stale entries", () => {
    const present = new Set(files.map(rel));
    const stale = Object.keys(ALLOW).filter((r) => !present.has(r));
    expect(stale).toEqual([]);
  });

  it("an agent-portal route never uses the staff session", () => {
    const agent = files.filter((f) => rel(f).startsWith("agent/"));
    const leaking = agent.filter((f) => /\brequireSession\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(leaking).toEqual([]);
  });
});
