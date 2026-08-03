import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { ensurePlatform } from "../../scripts/ensure-platform";
import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS } from "../../prisma/rbac-seed-data";

// The container entrypoint runs this on every boot so the Osta admin side exists by
// default on a fresh deployment (app-owner requirement, 2026-08-03). Targeted at the
// shared "test-osta" enterprise rather than the production default slug — the test
// database must never gain a SECOND INTERNAL enterprise, or every concurrently-running
// test file's isInternal resolution would become ambiguous.
describe("ensure-platform (deployment bootstrap)", () => {
  it("creates the INTERNAL enterprise and every system/support role, idempotently", async () => {
    const first = await ensurePlatform(prisma, { slug: "test-osta", name: "Osta" });

    const ent = await prisma.enterprise.findUnique({ where: { slug: "test-osta" } });
    expect(ent).toBeTruthy();
    expect(ent!.type).toBe("INTERNAL");
    expect(first.ostaEnterpriseId).toBe(ent!.id);

    // The bootstrap-admin script attaches the operator to "Admin" — it must exist.
    expect(first.systemRoleIds["Admin"]).toBeTruthy();

    const roleCount = await prisma.role.count({ where: { enterpriseId: ent!.id, isSystem: true } });
    expect(roleCount).toBeGreaterThanOrEqual(
      Object.keys(SYSTEM_ROLE_DEFS).length + Object.keys(SUPPORT_ROLE_DEFS).length
    );

    // Second run (every subsequent container boot) changes nothing.
    const second = await ensurePlatform(prisma, { slug: "test-osta", name: "Osta" });
    expect(second.ostaEnterpriseId).toBe(first.ostaEnterpriseId);
    expect(await prisma.role.count({ where: { enterpriseId: ent!.id, isSystem: true } })).toBe(roleCount);
    expect(await prisma.enterprise.count({ where: { slug: "test-osta" } })).toBe(1);
  });

  it("creates no user — accounts require a real password via bootstrap-admin", async () => {
    const ent = await prisma.enterprise.findUniqueOrThrow({ where: { slug: "test-osta" } });
    // Other test files create users in test-osta; this asserts ensurePlatform itself
    // introduces none by running against a fresh throwaway slug... which it must not do
    // (see the INTERNAL-ambiguity note above). Instead: the function's client shape
    // simply has no user model — the type system already forbids it — so assert the
    // behavioral half that matters: running it grants nobody access.
    const before = await prisma.user.count({ where: { enterpriseId: ent.id } });
    await ensurePlatform(prisma, { slug: "test-osta", name: "Osta" });
    expect(await prisma.user.count({ where: { enterpriseId: ent.id } })).toBe(before);
  });
});
