import { describe, it, expect } from "vitest";
import { checkDocsText, runDocsCheck } from "@/lib/docs-check";

// The public docs (the /docs portal, the OpenAPI file, the developer markdown) must never
// carry a secret, a real customer's name or an internal detail — BOOKING_API_ADDONS_PLAN.md
// Phase 6. This runs the real check over the real files, so a leak fails the suite.

describe("docs check", () => {
  it("the published documentation is clean", () => {
    const findings = runDocsCheck();
    expect(findings, findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.text}`).join("\n")).toEqual([]);
  });

  it("catches planted secrets, customers, internal details, emails and hosts", () => {
    const rules = (text: string, file = "x.md") => checkDocsText(file, text).map((f) => f.rule);
    expect(rules(`Authorization: Bearer wsk_${"a1".repeat(32)}`)).toContain("api-key");
    expect(rules(`secret whsec_${"0f".repeat(32)}`)).toContain("webhook-secret");
    expect(rules("Example: Veyo Island Villas")).toContain("real-customer");
    expect(rules("DATABASE_URL=postgresql://osta:devpass@localhost:55432/x")).toContain("internal-config");
    expect(rules("see src/lib/website-api/key.ts")).toContain("internal-path");
    expect(rules("mail ops@realhotel.mv")).toContain("real-email");
    expect(rules("https://realhotel.mv/booking")).toContain("real-host");
    // What examples may use.
    expect(rules("wsk_… and whsec_… and ada@example.com at https://stay.uppsolut.com/api and https://cdn.example.com/a.jpg")).toEqual([]);
  });

  it("ignores comments in page source — they are never rendered", () => {
    expect(checkDocsText("page.tsx", "// see src/lib/website-api/key.ts\nconst x = 1")).toEqual([]);
    expect(checkDocsText("page.tsx", "/* src/app/docs */ const y = 'https://evil.example.org'")).toEqual([]);
  });
});
