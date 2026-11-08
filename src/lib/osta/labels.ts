// Plain labels shared by the Osta console's server pages and client tables. Kept out of
// any "use client" module: a server component importing a constant from one gets a
// client reference, not the object.
export const PROPERTY_STATUS_LABEL: Record<string, string> = { ACTIVE: "Live", PENDING: "Awaiting approval", REJECTED: "Rejected" }
