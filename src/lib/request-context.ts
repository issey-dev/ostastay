import { AsyncLocalStorage } from "node:async_hooks";

// Ambient per-request tenant identity, set once by requireSession() and read by the
// Prisma operation recorder in src/lib/db.ts — so DB load can be attributed to an
// enterprise/property on the Osta DB Health dashboard without threading the auth
// context through every query call site.
//
// enterWith() (rather than run()) binds the store to the remainder of the current
// async execution — exactly the shape of "requireSession() is awaited first, every
// query in the handler happens after it". Requests that never authenticate (login,
// public eRegistration token pages) simply record with a null tenant.
export type RequestTenantContext = {
  enterpriseId: string;
  propertyId: string | null;
};

const storage = new AsyncLocalStorage<RequestTenantContext>();

export function setRequestTenantContext(ctx: RequestTenantContext): void {
  storage.enterWith(ctx);
}

export function getRequestTenantContext(): RequestTenantContext | null {
  return storage.getStore() ?? null;
}
