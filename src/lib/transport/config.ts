import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { logActivity } from "@/lib/activity-log"
import { BookingError } from "@/lib/booking-error"
import {
  fromZod,
  getTransportSettings,
  invalid,
  notFound,
  type TransportActor,
} from "@/lib/transport/common"
import {
  locationSchema,
  providerSchema,
  rateSchema,
  routeSchema,
  settingsPatchSchema,
  typeSchema,
  vesselSchema,
} from "@/lib/transport/schemas"
import { dateKeyToDate, dateToKey } from "@/lib/transport/time"
import type { z } from "zod"

// Transportation configuration — the six catalogue entities, the module settings and the
// "load defaults" seeder. Property-scoped throughout: every lookup is `{ id, propertyId }`,
// so an id from another property is simply "not found", and every referenced id (origin,
// charge code, tax profile...) is checked to be this property's own.
//
// Nothing referenced is ever hard-deleted: DELETE refuses with IN_USE and the screen offers
// "deactivate" (isActive=false) instead. Every change is written to the activity log under
// CONTROLS, the module the Hub section is gated by.

export const CONFIG_ENTITIES = ["types", "locations", "routes", "providers", "vessels", "rates"] as const
export type ConfigEntity = (typeof CONFIG_ENTITIES)[number]

export function isConfigEntity(v: string): v is ConfigEntity {
  return (CONFIG_ENTITIES as readonly string[]).includes(v)
}

type Row = Record<string, unknown> & { id: string }
// The six delegates share the shape these generic helpers use; Prisma's own types do not
// unify across models, so the registry holds them through this narrow structural type.
type Delegate = {
  findFirst(args: unknown): Promise<Row | null>
  findMany(args: unknown): Promise<Row[]>
  create(args: unknown): Promise<Row>
  update(args: unknown): Promise<Row>
  delete(args: unknown): Promise<Row>
}

type EntityDef = {
  label: string
  entityType: string
  delegate: () => Delegate
  include?: object
  orderBy: object
  /** Full input schema (create, and update after merging). */
  schema: z.ZodTypeAny
  /** A stored row back in input shape, so an update can be a partial patch. */
  toInput: (row: Row) => Record<string, unknown>
  /** Input → Prisma data. */
  toData: (input: Record<string, unknown>) => Record<string, unknown>
  /** Referenced ids must be this property's. */
  checkRefs?: (propertyId: string, input: Record<string, unknown>) => Promise<void>
  /** How many rows reference this one (blocks DELETE). */
  usage: (id: string) => Promise<number>
  describe: (row: Row) => string
  duplicate: string
}

async function ownedOrThrow(
  model: "transportLocation" | "transportType" | "transportProvider" | "transportRoute",
  id: unknown,
  propertyId: string,
  what: string
) {
  if (!id) return
  const where = { id: String(id), propertyId }
  const found =
    model === "transportLocation"
      ? await prisma.transportLocation.findFirst({ where, select: { id: true } })
      : model === "transportType"
        ? await prisma.transportType.findFirst({ where, select: { id: true } })
        : model === "transportProvider"
          ? await prisma.transportProvider.findFirst({ where, select: { id: true } })
          : await prisma.transportRoute.findFirst({ where, select: { id: true } })
  if (!found) throw invalid(`${what} not found at this property`, "INVALID_REFERENCE")
}

const strip = (row: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))

const DEFS: Record<ConfigEntity, EntityDef> = {
  types: {
    label: "Transport type",
    entityType: "TransportType",
    delegate: () => prisma.transportType as unknown as Delegate,
    orderBy: { code: "asc" },
    schema: typeSchema,
    toInput: (r) => strip(r, ["code", "name", "mode", "requiresFlightDetails", "isActive"]),
    toData: (i) => i,
    usage: async (id) =>
      (await prisma.transportRoute.count({ where: { transportTypeId: id } })) +
      (await prisma.transportRate.count({ where: { transportTypeId: id } })) +
      (await prisma.transportVessel.count({ where: { transportTypeId: id } })) +
      (await prisma.transportBooking.count({ where: { transportTypeId: id } })) +
      (await prisma.transportManifest.count({ where: { transportTypeId: id } })),
    describe: (r) => `${r.name} (${r.code})`,
    duplicate: "A transport type with this code already exists at this property",
  },
  locations: {
    label: "Location",
    entityType: "TransportLocation",
    delegate: () => prisma.transportLocation as unknown as Delegate,
    orderBy: { code: "asc" },
    schema: locationSchema,
    toInput: (r) => strip(r, ["code", "name", "type", "notes", "isActive"]),
    toData: (i) => i,
    usage: async (id) => prisma.transportRoute.count({ where: { OR: [{ originId: id }, { destinationId: id }] } }),
    describe: (r) => `${r.name} (${r.code})`,
    duplicate: "A location with this code already exists at this property",
  },
  routes: {
    label: "Route",
    entityType: "TransportRoute",
    delegate: () => prisma.transportRoute as unknown as Delegate,
    include: {
      origin: { select: { id: true, code: true, name: true, type: true } },
      destination: { select: { id: true, code: true, name: true, type: true } },
      transportType: { select: { id: true, code: true, name: true, mode: true, requiresFlightDetails: true } },
    },
    orderBy: { code: "asc" },
    schema: routeSchema,
    toInput: (r) =>
      strip(r, ["code", "name", "originId", "destinationId", "transportTypeId", "category", "direction", "durationMinutes", "instructions", "departureSlots", "isActive"]),
    toData: (i) => i,
    checkRefs: async (pid, i) => {
      await ownedOrThrow("transportLocation", i.originId, pid, "Origin")
      await ownedOrThrow("transportLocation", i.destinationId, pid, "Destination")
      await ownedOrThrow("transportType", i.transportTypeId, pid, "Transport type")
    },
    usage: async (id) =>
      (await prisma.transportRate.count({ where: { routeId: id } })) +
      (await prisma.transportBooking.count({ where: { routeId: id } })) +
      (await prisma.transportManifest.count({ where: { routeId: id } })),
    describe: (r) => `${r.name} (${r.code})`,
    duplicate: "A route with this code already exists at this property",
  },
  providers: {
    label: "Provider",
    entityType: "TransportProvider",
    delegate: () => prisma.transportProvider as unknown as Delegate,
    include: { vessels: { orderBy: { name: "asc" }, include: { transportType: { select: { id: true, code: true, name: true } } } } },
    orderBy: { name: "asc" },
    schema: providerSchema,
    toInput: (r) => strip(r, ["name", "kind", "contactName", "phone", "email", "notes", "isActive"]),
    toData: (i) => i,
    usage: async (id) =>
      (await prisma.transportVessel.count({ where: { providerId: id } })) +
      (await prisma.transportRate.count({ where: { providerId: id } })) +
      (await prisma.transportBooking.count({ where: { providerId: id } })) +
      (await prisma.transportManifest.count({ where: { providerId: id } })),
    describe: (r) => String(r.name),
    duplicate: "A provider with this name already exists at this property",
  },
  vessels: {
    label: "Vessel",
    entityType: "TransportVessel",
    delegate: () => prisma.transportVessel as unknown as Delegate,
    include: {
      provider: { select: { id: true, name: true, kind: true } },
      transportType: { select: { id: true, code: true, name: true } },
    },
    orderBy: { name: "asc" },
    schema: vesselSchema,
    toInput: (r) => strip(r, ["providerId", "name", "transportTypeId", "capacity", "registration", "isActive"]),
    toData: (i) => i,
    checkRefs: async (pid, i) => {
      await ownedOrThrow("transportProvider", i.providerId, pid, "Provider")
      await ownedOrThrow("transportType", i.transportTypeId, pid, "Transport type")
    },
    usage: async (id) =>
      (await prisma.transportBooking.count({ where: { vesselId: id } })) +
      (await prisma.transportManifest.count({ where: { vesselId: id } })),
    describe: (r) => String(r.name),
    duplicate: "A vessel with this name already exists",
  },
  rates: {
    label: "Rate",
    entityType: "TransportRate",
    delegate: () => prisma.transportRate as unknown as Delegate,
    include: {
      route: { select: { id: true, code: true, name: true } },
      transportType: { select: { id: true, code: true, name: true } },
      provider: { select: { id: true, name: true } },
      chargeCode: { select: { id: true, code: true, description: true } },
      taxProfile: { select: { id: true, name: true } },
    },
    orderBy: [{ routeId: "asc" }, { validFrom: "asc" }],
    schema: rateSchema,
    toInput: (r) => ({
      ...strip(r, [
        "routeId", "transportTypeId", "providerId", "name", "direction", "pricingBasis", "price", "adultPrice", "childPrice",
        "infantPrice", "childMinAge", "childMaxAge", "chargeCodeId", "taxMode", "taxProfileId", "isBillable", "isActive",
      ]),
      validFrom: r.validFrom ? dateToKey(r.validFrom as Date) : null,
      validTo: r.validTo ? dateToKey(r.validTo as Date) : null,
    }),
    toData: (i) => ({
      ...i,
      validFrom: i.validFrom ? dateKeyToDate(String(i.validFrom)) : null,
      validTo: i.validTo ? dateKeyToDate(String(i.validTo)) : null,
      taxProfileId: i.taxMode === "CUSTOM" ? i.taxProfileId : null,
    }),
    checkRefs: async (pid, i) => {
      await ownedOrThrow("transportRoute", i.routeId, pid, "Route")
      await ownedOrThrow("transportType", i.transportTypeId, pid, "Transport type")
      await ownedOrThrow("transportProvider", i.providerId, pid, "Provider")
      const code = await prisma.chargeCode.findFirst({ where: { id: String(i.chargeCodeId), propertyId: pid }, select: { postingType: true } })
      if (!code) throw invalid("Charge code not found at this property", "INVALID_REFERENCE")
      if (code.postingType !== "CHARGE") throw invalid("Choose a revenue charge code (not a tax, credit or payment code)", "INVALID_REFERENCE")
      if (i.taxMode === "CUSTOM") {
        const tp = await prisma.taxProfile.findFirst({ where: { id: String(i.taxProfileId), propertyId: pid }, select: { id: true } })
        if (!tp) throw invalid("Tax profile not found at this property", "INVALID_REFERENCE")
      }
    },
    usage: async (id) => prisma.transportBooking.count({ where: { rateId: id } }),
    describe: (r) => `rate ${r.name ?? r.id.slice(0, 8)}`,
    duplicate: "This rate already exists",
  },
}

/** Rows ready for JSON: date-only columns as yyyy-MM-dd. */
export function serializeConfigRow(entity: ConfigEntity, row: Row): Row {
  if (entity !== "rates") return row
  return {
    ...row,
    validFrom: row.validFrom ? dateToKey(row.validFrom as Date) : null,
    validTo: row.validTo ? dateToKey(row.validTo as Date) : null,
  }
}

export async function listConfig(propertyId: string, entity: ConfigEntity, opts: { activeOnly?: boolean } = {}) {
  const def = DEFS[entity]
  const rows = await def.delegate().findMany({
    where: { propertyId, ...(opts.activeOnly ? { isActive: true } : {}) },
    include: def.include,
    orderBy: def.orderBy,
  })
  return rows.map((r) => serializeConfigRow(entity, r))
}

export async function getConfig(propertyId: string, entity: ConfigEntity, id: string) {
  const def = DEFS[entity]
  const row = await def.delegate().findFirst({ where: { id, propertyId }, include: def.include })
  if (!row) throw notFound(def.label)
  return serializeConfigRow(entity, row)
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
}

export async function createConfig(actor: TransportActor, propertyId: string, entity: ConfigEntity, body: unknown) {
  const def = DEFS[entity]
  const parsed = def.schema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const input = parsed.data as Record<string, unknown>
  await def.checkRefs?.(propertyId, input)
  try {
    const row = await def.delegate().create({ data: { ...def.toData(input), propertyId }, include: def.include })
    await logActivity({
      ctx: actor.ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: def.entityType,
      entityId: row.id,
      description: `Transportation: created ${def.label.toLowerCase()} ${def.describe(row)}`,
      metadata: { propertyId, source: actor.source },
    })
    return serializeConfigRow(entity, row)
  } catch (e) {
    if (isUniqueViolation(e)) throw new BookingError(409, "DUPLICATE", def.duplicate)
    throw e
  }
}

export async function updateConfig(actor: TransportActor, propertyId: string, entity: ConfigEntity, id: string, body: unknown) {
  const def = DEFS[entity]
  const existing = await def.delegate().findFirst({ where: { id, propertyId } })
  if (!existing) throw notFound(def.label)
  const patch = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const parsed = def.schema.safeParse({ ...def.toInput(existing), ...patch })
  if (!parsed.success) throw fromZod(parsed.error)
  const input = parsed.data as Record<string, unknown>
  await def.checkRefs?.(propertyId, input)
  try {
    const row = await def.delegate().update({ where: { id }, data: def.toData(input), include: def.include })
    const deactivated = existing.isActive === true && row.isActive === false
    const reactivated = existing.isActive === false && row.isActive === true
    await logActivity({
      ctx: actor.ctx,
      module: "CONTROLS",
      action: deactivated ? "DEACTIVATE" : reactivated ? "REACTIVATE" : "UPDATE",
      entityType: def.entityType,
      entityId: id,
      description: `Transportation: ${deactivated ? "deactivated" : reactivated ? "reactivated" : "updated"} ${def.label.toLowerCase()} ${def.describe(row)}`,
      metadata: { propertyId, source: actor.source, changed: Object.keys(patch) },
    })
    return serializeConfigRow(entity, row)
  } catch (e) {
    if (isUniqueViolation(e)) throw new BookingError(409, "DUPLICATE", def.duplicate)
    throw e
  }
}

/** Hard delete — only while nothing references the row. Otherwise deactivate. */
export async function deleteConfig(actor: TransportActor, propertyId: string, entity: ConfigEntity, id: string) {
  const def = DEFS[entity]
  const existing = await def.delegate().findFirst({ where: { id, propertyId } })
  if (!existing) throw notFound(def.label)
  const used = await def.usage(id)
  if (used > 0) {
    throw new BookingError(409, "IN_USE", `This ${def.label.toLowerCase()} is in use and cannot be deleted — deactivate it instead.`)
  }
  await def.delegate().delete({ where: { id } })
  await logActivity({
    ctx: actor.ctx,
    module: "CONTROLS",
    action: "DELETE",
    entityType: def.entityType,
    entityId: id,
    description: `Transportation: deleted ${def.label.toLowerCase()} ${def.describe(existing)}`,
    metadata: { propertyId, source: actor.source },
  })
  return { success: true }
}

// ── Settings ──────────────────────────────────────────────────────────────────────────

export async function updateTransportSettings(actor: TransportActor, propertyId: string, body: unknown) {
  const parsed = settingsPatchSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const patch = parsed.data
  const current = await getTransportSettings(propertyId)
  const next = { ...current, ...patch }
  if (patch.defaultChargeCodeId) {
    const code = await prisma.chargeCode.findFirst({ where: { id: patch.defaultChargeCodeId, propertyId }, select: { postingType: true } })
    if (!code || code.postingType !== "CHARGE") throw invalid("Charge code not found at this property", "INVALID_REFERENCE")
  }
  if (next.defaultTaxMode === "CUSTOM") {
    if (!next.defaultTaxProfileId) throw invalid("Choose the default tax profile")
    const tp = await prisma.taxProfile.findFirst({ where: { id: next.defaultTaxProfileId, propertyId }, select: { id: true } })
    if (!tp) throw invalid("Tax profile not found at this property", "INVALID_REFERENCE")
  } else {
    next.defaultTaxProfileId = null
  }
  const data = {
    enabled: next.enabled,
    defaultTaxMode: next.defaultTaxMode,
    defaultTaxProfileId: next.defaultTaxProfileId,
    defaultChargeCodeId: next.defaultChargeCodeId,
    requireProvider: next.requireProvider,
    attentionToleranceMinutes: next.attentionToleranceMinutes,
  }
  const saved = await prisma.transportSettings.upsert({ where: { propertyId }, create: { propertyId, ...data }, update: data })
  const switched = patch.enabled !== undefined && patch.enabled !== current.enabled
  await logActivity({
    ctx: actor.ctx,
    module: "CONTROLS",
    action: switched ? (patch.enabled ? "ENABLE" : "DISABLE") : "UPDATE",
    entityType: "TransportSettings",
    entityId: saved.id,
    description: switched
      ? `Transportation ${patch.enabled ? "switched on" : "switched off"} for the property`
      : "Transportation: updated module settings",
    metadata: { propertyId, changed: Object.keys(patch) },
  })
  return saved
}

// ── Load defaults ─────────────────────────────────────────────────────────────────────

const DEFAULT_TYPES = [
  { code: "SPB", name: "Speedboat", mode: "SPEEDBOAT", requiresFlightDetails: false },
  { code: "SPL", name: "Seaplane", mode: "SEAPLANE", requiresFlightDetails: true },
  { code: "DOM", name: "Domestic flight", mode: "DOMESTIC_FLIGHT", requiresFlightDetails: true },
  { code: "FRY", name: "Public ferry", mode: "FERRY", requiresFlightDetails: false },
  { code: "CAR", name: "Car / van", mode: "LAND", requiresFlightDetails: false },
] as const

/**
 * The transport charge code a rate defaults to — the property's own TRANSPORT-bucket code,
 * created under the canonical Transport group (TRP / 50RV, src/lib/posting/charge-tree.ts)
 * when the property has none. New properties get only system codes (owner, 2026-09-24), so
 * this is the "create a Transportation charge code if none exists" step.
 */
export async function ensureTransportChargeCode(propertyId: string): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.chargeCode.findFirst({
    where: { propertyId, isActive: true, postingType: "CHARGE", chargeSubgroup: { chargeGroup: { reportBucket: "TRANSPORT" } } },
    orderBy: { code: "asc" },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { enterpriseId: true } })
  const enterpriseId = property.enterpriseId
  return prisma.$transaction(async (tx) => {
    const group =
      (await tx.chargeGroup.findFirst({ where: { propertyId, reportBucket: "TRANSPORT" }, orderBy: { sortOrder: "asc" } })) ??
      (await tx.chargeGroup.create({
        data: { enterpriseId, propertyId, code: "TRP", name: "Transport", reportBucket: "TRANSPORT", isRevenue: true, sortOrder: 50 },
      }))
    const subgroup =
      (await tx.chargeSubgroup.findFirst({ where: { propertyId, chargeGroupId: group.id }, orderBy: { sortOrder: "asc" } })) ??
      (await tx.chargeSubgroup.create({
        data: { enterpriseId, propertyId, chargeGroupId: group.id, code: "50RV", name: "Transport", sortOrder: 50 },
      }))
    const taken = new Set((await tx.chargeCode.findMany({ where: { propertyId }, select: { code: true } })).map((c) => c.code))
    let n = 5001
    while (taken.has(String(n)) && n < 5099) n++
    const code = await tx.chargeCode.create({
      data: {
        enterpriseId,
        propertyId,
        code: String(n),
        description: "Transportation",
        chargeSubgroupId: subgroup.id,
        postingType: "CHARGE",
        useDefaultTax: true,
      },
    })
    return { id: code.id, created: true }
  })
}

/**
 * Seed a property's transport catalogue with the Maldivian basics: the five transport types,
 * Velana International Airport and the property itself as locations, and a Transportation
 * charge code. Idempotent — anything that already exists (matched by code) is skipped,
 * never overwritten. Routes and rates are the property's own and are not guessed.
 */
export async function loadTransportDefaults(actor: TransportActor, propertyId: string) {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { name: true } })
  const created: string[] = []
  const skipped: string[] = []

  for (const t of DEFAULT_TYPES) {
    const exists = await prisma.transportType.findUnique({ where: { propertyId_code: { propertyId, code: t.code } } })
    if (exists) skipped.push(`Type ${t.code}`)
    else {
      await prisma.transportType.create({ data: { propertyId, ...t } })
      created.push(`Type ${t.code}`)
    }
  }
  const lowered = property.name.toLowerCase()
  const homeType = lowered.includes("guest") ? "GUESTHOUSE" : lowered.includes("resort") ? "RESORT" : "ISLAND"
  const locations = [
    { code: "MLE", name: "Velana International Airport", type: "AIRPORT" },
    { code: "HOME", name: property.name, type: homeType },
  ]
  for (const l of locations) {
    const exists = await prisma.transportLocation.findUnique({ where: { propertyId_code: { propertyId, code: l.code } } })
    if (exists) skipped.push(`Location ${l.code}`)
    else {
      await prisma.transportLocation.create({ data: { propertyId, ...l } })
      created.push(`Location ${l.code}`)
    }
  }
  const code = await ensureTransportChargeCode(propertyId)
  if (code.created) created.push("Transportation charge code")
  const settings = await getTransportSettings(propertyId)
  if (!settings.defaultChargeCodeId) {
    await prisma.transportSettings.upsert({
      where: { propertyId },
      create: { propertyId, defaultChargeCodeId: code.id },
      update: { defaultChargeCodeId: code.id },
    })
  }

  await logActivity({
    ctx: actor.ctx,
    module: "CONTROLS",
    action: "CREATE",
    entityType: "TransportSettings",
    entityId: propertyId,
    description: `Transportation: loaded defaults (${created.length} added, ${skipped.length} already there)`,
    metadata: { propertyId, created, skipped },
  })
  return { created, skipped }
}

/** Everything the Hub page and the booking form need in one read. */
export async function configBundle(propertyId: string) {
  const [settings, types, locations, routes, providers, vessels, rates, chargeCodes, taxProfiles] = await Promise.all([
    getTransportSettings(propertyId),
    listConfig(propertyId, "types"),
    listConfig(propertyId, "locations"),
    listConfig(propertyId, "routes"),
    listConfig(propertyId, "providers"),
    listConfig(propertyId, "vessels"),
    listConfig(propertyId, "rates"),
    prisma.chargeCode.findMany({
      where: { propertyId, postingType: "CHARGE" },
      select: {
        id: true,
        code: true,
        description: true,
        postingType: true,
        isActive: true,
        chargeSubgroup: { select: { code: true, name: true, sortOrder: true, chargeGroup: { select: { code: true, name: true, reportBucket: true, sortOrder: true } } } },
      },
      orderBy: { code: "asc" },
    }),
    prisma.taxProfile.findMany({ where: { propertyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ])
  return { settings, types, locations, routes, providers, vessels, rates, chargeCodes, taxProfiles }
}
