import * as z from "zod"

// Rules for a staff account's sign-in identity, shared by the People form
// (src/components/controls/users-roles-manager.tsx) and its API
// (src/app/api/settings/users/route.ts) so the two can never disagree.
//
// Pure — no Prisma, safe to import from a client component.

/** Same floor as the handover change-password flow (src/app/api/auth/change-password):
 *  every account here can reach enterprise data, and an admin-set password should not be
 *  weaker than the one a new customer is made to choose for themselves. */
export const MIN_PASSWORD_LENGTH = 12

/** Sign-in lower-cases the address before its lookup (src/app/api/auth/login), so an
 *  account stored as "Jane@Hotel.mv" could never sign in. Every write normalises. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

export const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`

/** The identity fields of the Add / Edit Team Member dialog. `password` is required when
 *  creating; when editing an empty one means "leave unchanged". */
export function userIdentitySchema(mode: "create" | "edit") {
  return z.object({
    firstName: z.string().trim().min(1, "First name is required."),
    lastName: z.string().trim().min(1, "Last name is required."),
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    password:
      mode === "create"
        ? z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT)
        : z.union([z.literal(""), z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT)]),
  })
}
