import type { TransportSettings } from "@prisma/client"
import { prisma } from "@/lib/db"
import { BookingError } from "@/lib/booking-error"
import { hasPermission, type AuthContext } from "@/lib/scope"
import { systemActorContext } from "@/lib/system-actor"
import { zodMessage } from "@/lib/transport/schemas"
import type { ZodError } from "zod"

// Shared plumbing for the Transportation services (src/lib/transport/*). The services are
// called by the desk's session routes AND the public Booking API, so — like the Excursion
// and Spa services — they throw BookingError and each caller maps it to its own response.

export type TransportActor = {
  /** For the activity log (and the cashier shift a desk posting is attributed to). */
  ctx: AuthContext
  /** Recorded as createdBy; a real User row (the enterprise's Online Bookings user for the API). */
  userId: string
  /** TRANSPORTATION delete: post/waive charges by hand, custom amounts, price overrides. */
  canBill: boolean
  /** CASHIERING update: void a posted charge (the folio void rule). */
  canVoid: boolean
  source: "DESK" | "API"
}

export function sessionActor(ctx: AuthContext): TransportActor {
  return {
    ctx,
    userId: ctx.userId,
    canBill: hasPermission(ctx, "TRANSPORTATION", "delete"),
    canVoid: hasPermission(ctx, "CASHIERING", "update"),
    source: "DESK",
  }
}

/** The Booking API acts as the enterprise's Online Bookings user. A TRANSPORT-scoped key may
 *  post and waive charges, but never void one — folio corrections stay at the desk. */
export async function apiActor(enterpriseId: string): Promise<TransportActor> {
  const ctx = await systemActorContext(enterpriseId)
  return { ctx, userId: ctx.userId, canBill: true, canVoid: false, source: "API" }
}

export const TRANSPORT_SETTINGS_DEFAULTS = {
  enabled: false,
  defaultTaxMode: "CHARGE_CODE",
  defaultTaxProfileId: null as string | null,
  defaultChargeCodeId: null as string | null,
  requireProvider: false,
  attentionToleranceMinutes: 60,
}
export type TransportSettingsValues = Omit<TransportSettings, "id" | "propertyId" | "updatedAt">

export async function getTransportSettings(propertyId: string): Promise<TransportSettingsValues> {
  const row = await prisma.transportSettings.findUnique({ where: { propertyId } })
  if (!row) return { ...TRANSPORT_SETTINGS_DEFAULTS }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, propertyId: _p, updatedAt, ...values } = row
  return values
}

/** Operations refuse a property that has not switched the module on. */
export async function assertTransportEnabled(propertyId: string): Promise<TransportSettingsValues> {
  const settings = await getTransportSettings(propertyId)
  if (!settings.enabled) {
    throw new BookingError(403, "TRANSPORT_NOT_ENABLED", "Transportation is not switched on for this property. Turn it on in the Hub (Transportation).")
  }
  return settings
}

export function notFound(what: string): BookingError {
  return new BookingError(404, "NOT_FOUND", `${what} not found`)
}

export function invalid(message: string, code = "INVALID_INPUT"): BookingError {
  return new BookingError(400, code, message)
}

export function fromZod(error: ZodError): BookingError {
  return new BookingError(400, "INVALID_INPUT", zodMessage(error), { details: error.issues })
}

export function forbidden(message: string): BookingError {
  return new BookingError(403, "FORBIDDEN", message)
}

export async function propertyTz(propertyId: string): Promise<{ timeZone: string; pricesIncludeTaxes: boolean; businessDate: Date | null; defaultCurrency: string; enterpriseId: string; name: string }> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { timeZone: true, pricesIncludeTaxes: true, businessDate: true, defaultCurrency: true, enterpriseId: true, name: true },
  })
  if (!p) throw notFound("Property")
  return { ...p, timeZone: p.timeZone || "UTC" }
}
