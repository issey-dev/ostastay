import { describe, it, expect } from "vitest"
import { canDo, worksAt, type AudienceUser } from "@/lib/notifications/audience"
import { safeUrl } from "@/lib/notifications/notify"

const perm = (module: string, v: Partial<Record<"canView" | "canCreate" | "canUpdate" | "canDelete", boolean>> = {}) => ({
  module, canView: false, canCreate: false, canUpdate: false, canDelete: false, ...v,
})
const user = (roles: ReturnType<typeof perm>[][]): Pick<AudienceUser, "roles"> => ({ roles: roles.map((permissions) => ({ role: { permissions } })) })

describe("notification audience rules", () => {
  it("an enterprise user works at every property, a property user only at their own", () => {
    expect(worksAt({ scope: "ENTERPRISE", propertyId: null }, "P1")).toBe(true)
    expect(worksAt({ scope: "PROPERTY", propertyId: "P1" }, "P1")).toBe(true)
    expect(worksAt({ scope: "PROPERTY", propertyId: "P1" }, "P2")).toBe(false)
    expect(worksAt({ scope: "PROPERTY", propertyId: "P1" }, null)).toBe(false)
  })

  it("module access is the union of every role the user holds", () => {
    const u = user([[perm("NIGHT_AUDIT")], [perm("NIGHT_AUDIT", { canView: true })]])
    expect(canDo(u, "NIGHT_AUDIT", "view")).toBe(true)
    expect(canDo(u, "NIGHT_AUDIT", "update")).toBe(false)
  })

  it("a different module's grant does not count", () => {
    expect(canDo(user([[perm("CASHIERING", { canView: true })]]), "NIGHT_AUDIT", "view")).toBe(false)
    expect(canDo(user([]), "NIGHT_AUDIT", "view")).toBe(false)
  })

  it("only same-origin paths are accepted as a link target", () => {
    expect(safeUrl("/e/acme/dashboard")).toBe("/e/acme/dashboard")
    expect(safeUrl("https://evil.example")).toBeNull()
    expect(safeUrl("//evil.example")).toBeNull()
    expect(safeUrl(undefined)).toBeNull()
  })
})
