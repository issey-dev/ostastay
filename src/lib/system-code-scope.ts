// Which level each dropdown list (SystemCode category) lives at — 2026-09-23 owner
// decision, .agents/docs/HUB_SETUP_PLAN.md Phase 3.
//
// PROPERTY lists belong to one property: each property keeps its own options, edits them
// in the Hub under its own name, and never sees another property's. They describe how a
// property runs — its housekeeping requests, what a guest can ask for on a booking, how
// guests are transferred, and its rooms' beds, views and amenities.
//
// Every other category is an ENTERPRISE list (propertyId null): the guest-profile lists
// (Gender, Title, Nationality, ...) because a guest profile is shared by every property of
// the enterprise, and Job Functions because a user is.
//
// No server imports — the Hub editors and the dropdown components use this too.

export const PROPERTY_LIST_CATEGORIES = [
  "HOUSEKEEPING_REQUEST",
  "SPECIAL_REQUEST",
  "TRANSPORT_TYPE",
  "BED_TYPE",
  "ROOM_VIEW",
  "ROOM_AMENITY",
] as const;

export type PropertyListCategory = (typeof PROPERTY_LIST_CATEGORIES)[number];

export function isPropertyListCategory(category: string): category is PropertyListCategory {
  return (PROPERTY_LIST_CATEGORIES as readonly string[]).includes(category);
}
