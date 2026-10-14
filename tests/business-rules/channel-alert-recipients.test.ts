import { describe, it, expect, beforeAll } from "vitest";

const { prisma } = await import("@/lib/db");
const { makeChannelProperty } = await import("../helpers/channel");
const { getChannelAlertRecipients } = await import("@/lib/channels/alert-recipients");

// Who is told when a channel connection breaks: active users who can UPDATE Integrations,
// limited to the properties they may see.
describe("Channel alert recipients", () => {
  let enterpriseId: string;
  let propA: string;
  let propB: string;
  let canFixRoleId: string;
  let viewOnlyRoleId: string;
  const emails: Record<string, string> = {};

  const mkUser = async (key: string, roleId: string, extra: Record<string, unknown> = {}) => {
    emails[key] = `alert-${key}-${Date.now()}@test.local`;
    await prisma.user.create({
      data: {
        enterpriseId,
        email: emails[key],
        passwordHash: "x",
        firstName: key,
        lastName: "T",
        roles: { create: { roleId } },
        ...extra,
      },
    });
  };

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Alert ${Date.now()}`, slug: `test-alert-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    propA = (await makeChannelProperty(enterpriseId, "Alert A")).id;
    propB = (await makeChannelProperty(enterpriseId, "Alert B")).id;
    const mkRole = async (name: string, canUpdate: boolean) =>
      (
        await prisma.role.create({
          data: { enterpriseId, name, permissions: { create: { module: "INTEGRATIONS", canView: true, canUpdate } } },
        })
      ).id;
    canFixRoleId = await mkRole(`Fixer ${Date.now()}`, true);
    viewOnlyRoleId = await mkRole(`Viewer ${Date.now()}`, false);

    await mkUser("enterprise", canFixRoleId, { scope: "ENTERPRISE" });
    await mkUser("ownprop", canFixRoleId, { scope: "PROPERTY", propertyId: propA });
    await mkUser("otherprop", canFixRoleId, { scope: "PROPERTY", propertyId: propB });
    await mkUser("viewer", viewOnlyRoleId, { scope: "ENTERPRISE" });
    await mkUser("inactive", canFixRoleId, { scope: "ENTERPRISE", isActive: false });
  });

  it("notifies enterprise admins and the failing property's own admins, nobody else", async () => {
    const got = await getChannelAlertRecipients(enterpriseId, [propA]);
    const byEmail = Object.fromEntries(got.map((r) => [r.email, r.propertyIds]));
    expect(Object.keys(byEmail).sort()).toEqual([emails.enterprise, emails.ownprop].sort());
    expect(byEmail[emails.enterprise]).toEqual([propA]);
    expect(byEmail[emails.ownprop]).toEqual([propA]);
  });

  it("tells each person only about the properties they may act on", async () => {
    const got = await getChannelAlertRecipients(enterpriseId, [propA, propB]);
    const byEmail = Object.fromEntries(got.map((r) => [r.email, r.propertyIds.sort()]));
    expect(byEmail[emails.enterprise]).toEqual([propA, propB].sort());
    expect(byEmail[emails.ownprop]).toEqual([propA]);
    expect(byEmail[emails.otherprop]).toEqual([propB]);
    expect(byEmail[emails.viewer]).toBeUndefined();
    expect(byEmail[emails.inactive]).toBeUndefined();
  });

  it("returns nothing when no property failed", async () => {
    expect(await getChannelAlertRecipients(enterpriseId, [])).toEqual([]);
  });
});
