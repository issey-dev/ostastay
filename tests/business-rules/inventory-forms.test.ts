import { describe, it, expect } from "vitest";
import {
  buildingFormSchema,
  emptyRoomForm,
  emptyRoomTypeForm,
  floorFormSchema,
  roomFormSchema,
  roomTypeFormSchema,
  roomTypePayload,
} from "@/lib/inventory-form-schemas";

// APP STANDARD 001 schemas behind the Rooms & Inventory dialogs (src/lib/inventory-form-schemas.ts).

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("Room type form", () => {
  const valid = { ...emptyRoomTypeForm, name: "Deluxe", code: "DLX" };

  it("accepts a normal room type and builds the API payload", () => {
    expect(roomTypeFormSchema.safeParse(valid).success).toBe(true);
    expect(roomTypePayload({ ...valid, maxOccupancy: "3", baseOccupancy: "2", isInactive: true }, "p1")).toMatchObject({
      propertyId: "p1",
      maxOccupancy: 3,
      baseOccupancy: 2,
      isActive: false,
      description: undefined,
    });
  });

  it("flags base occupancy above max occupancy on the base field", () => {
    const r = roomTypeFormSchema.safeParse({ ...valid, maxOccupancy: "2", baseOccupancy: "3" });
    expect(paths(r)).toEqual(["baseOccupancy"]);
  });

  it("requires name, code and whole-number occupancies of at least 1", () => {
    const r = roomTypeFormSchema.safeParse({ ...emptyRoomTypeForm, name: " ", code: "D", maxOccupancy: "0", baseOccupancy: "1.5" });
    expect(paths(r)).toEqual(expect.arrayContaining(["name", "code", "maxOccupancy", "baseOccupancy"]));
  });
});

describe("Building / floor forms", () => {
  it("requires a building name", () => {
    expect(buildingFormSchema.safeParse({ name: " " }).success).toBe(false);
    expect(buildingFormSchema.safeParse({ name: "Main" }).success).toBe(true);
  });

  it("requires the floor's building", () => {
    expect(paths(floorFormSchema.safeParse({ name: "1st", buildingId: "" }))).toEqual(["buildingId"]);
  });
});

describe("Room form", () => {
  it("needs building and floor for a physical room, neither for a pseudo one", () => {
    const base = { ...emptyRoomForm, roomNumber: "101", roomTypeId: "rt" };
    expect(paths(roomFormSchema.safeParse(base))).toEqual(["buildingId", "floorId"]);
    expect(roomFormSchema.safeParse({ ...base, isPseudo: true }).success).toBe(true);
    expect(roomFormSchema.safeParse({ ...base, buildingId: "b", floorId: "f" }).success).toBe(true);
  });

  it("requires a room number and a room type", () => {
    expect(paths(roomFormSchema.safeParse({ ...emptyRoomForm, isPseudo: true }))).toEqual(["roomNumber", "roomTypeId"]);
  });
});
