import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ destroySession: vi.fn(async () => {}) }));

import { GET } from "@/app/api/auth/session-expired/route";
import { destroySession } from "@/lib/auth";

// Regression: behind Caddy the standalone server binds HOSTNAME=0.0.0.0, and a Route
// Handler's request.url carries that bind address. Redirecting off it sent every timed-out
// user to https://0.0.0.0:3000/login. The redirect must not depend on request.url at all.
describe("GET /api/auth/session-expired", () => {
  it("clears the session and redirects with a relative /login Location", async () => {
    const res = await GET();
    expect(destroySession).toHaveBeenCalledOnce();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("location")).not.toContain("0.0.0.0");
  });
});
