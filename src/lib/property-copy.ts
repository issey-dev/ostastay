import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { ForbiddenError } from "@/lib/scope"
import { getPropertySettings, type PropertySettingsValues } from "@/lib/property-settings"
import { PROPERTY_LIST_CATEGORIES } from "@/lib/system-code-scope"
import { loadHubAddons } from "@/lib/hub-properties"
import type { HubAddon } from "@/components/hub/hub-nav"

// "Copy from another property" — onboarding help, not sharing (owner, 2026-09-23;
// .agents/docs/HUB_SETUP_PLAN.md Phase 5). Each property keeps its own copy of everything;
// this only saves typing it twice.
//
// The rules, the same for every section:
//   - An item is matched by its natural key (a code, or a name where the model has no code).
//   - An item the target property already has is WARNED about and SKIPPED — never
//     overwritten, and there is no option to overwrite.
//   - What an item needs is pulled along when the target lacks it (a charge code's group,
//     subgroup and tax profile; a payment method's charge code; a generate's generated
//     code), and reported as "pulled along" so nothing arrives unannounced.
//   - The whole copy is one transaction: it lands completely or not at all.
//
// Deliberately not copied: links to things that are physically one property's own — the
// posting-default pointers, rooms, sequences, anything with bookings behind it. An outlet
// subgroup keeps its outlet only when that outlet is copied in the same run. People are
// never copied either: Spa therapists (with their schedules, exceptions and skills) are the
// property's own staff, and excursion departures / bookings are dated operations.

export const COPY_SECTIONS = [
  "lists",
  "tax-profiles",
  "charge-codes",
  "payment-methods",
  "stationery",
  "meal-plans",
  "room-types",
  "outlets",
  "allocations",
  "spa",
  "excursions",
] as const
export type CopySection = (typeof COPY_SECTIONS)[number]

/** Sections that belong to an add-on — offered, and copied, only where the enterprise has it. */
export const SECTION_ADDON: Partial<Record<CopySection, HubAddon>> = { spa: "SPA", excursions: "EXCURSIONS" }

export function isCopySection(value: string): value is CopySection {
  return (COPY_SECTIONS as readonly string[]).includes(value)
}

/** One source item, and whether the target already has it (so it would be skipped). `group`
 *  heads the item in the preview when a section holds several kinds (the Spa catalogue). */
export type CopyPreviewItem = { key: string; label: string; detail: string | null; exists: boolean; group?: string }
export type CopyReportItem = { key: string; label: string }
export type CopyReport = { copied: CopyReportItem[]; skipped: CopyReportItem[]; pulled: CopyReportItem[] }

type Tx = Prisma.TransactionClient

// ─── Sections ──────────────────────────────────────────────────────────────────────

type SectionDef = {
  preview(from: string, to: string): Promise<CopyPreviewItem[]>
  copy(tx: Tx, ctx: CopyCtx, keys: Set<string>): Promise<void>
}

type CopyCtx = {
  from: string
  to: string
  enterpriseId: string
  report: CopyReport
  /** Source outlet id → target outlet id, for outlets copied in this run. */
  outletMap: Map<string, string>
}

const listKey = (category: string, code: string) => `${category}:${code}`

const lists: SectionDef = {
  async preview(from, to) {
    const where = (propertyId: string) => ({ propertyId, category: { in: [...PROPERTY_LIST_CATEGORIES] }, isActive: true })
    const [source, target] = await Promise.all([
      prisma.systemCode.findMany({ where: where(from), orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
      prisma.systemCode.findMany({ where: { propertyId: to }, select: { category: true, code: true } }),
    ])
    const have = new Set(target.map((t) => listKey(t.category, t.code)))
    return source.map((s) => ({
      key: listKey(s.category, s.code),
      label: s.value,
      detail: `${s.category.replace(/_/g, " ").toLowerCase()} · ${s.code}`,
      exists: have.has(listKey(s.category, s.code)),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.systemCode.findMany({ where: { propertyId: ctx.from, category: { in: [...PROPERTY_LIST_CATEGORIES] } } })
    for (const s of source) {
      const key = listKey(s.category, s.code)
      if (!keys.has(key)) continue
      const exists = await tx.systemCode.findFirst({ where: { propertyId: ctx.to, category: s.category, code: s.code }, select: { id: true } })
      if (exists) {
        ctx.report.skipped.push({ key, label: s.value })
        continue
      }
      await tx.systemCode.create({
        data: { enterpriseId: ctx.enterpriseId, propertyId: ctx.to, category: s.category, code: s.code, value: s.value, sortOrder: s.sortOrder, isActive: s.isActive },
      })
      ctx.report.copied.push({ key, label: s.value })
    }
  },
}

// Tax profiles have no code — the name is what an operator recognises them by.
async function ensureTaxProfile(tx: Tx, ctx: CopyCtx, sourceId: string, pulled: boolean): Promise<string> {
  const source = await tx.taxProfile.findUniqueOrThrow({ where: { id: sourceId }, include: { rates: true } })
  const existing = await tx.taxProfile.findFirst({ where: { propertyId: ctx.to, name: source.name }, select: { id: true } })
  if (existing) return existing.id
  const created = await tx.taxProfile.create({
    data: {
      enterpriseId: ctx.enterpriseId,
      propertyId: ctx.to,
      name: source.name,
      description: source.description,
      rates: {
        create: source.rates.map((r) => ({
          name: r.name, ratePercent: r.ratePercent, calculateOn: r.calculateOn, order: r.order,
          effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
        })),
      },
    },
  })
  ;(pulled ? ctx.report.pulled : ctx.report.copied).push({ key: source.name, label: `Tax profile ${source.name}` })
  return created.id
}

const taxProfiles: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.taxProfile.findMany({ where: { propertyId: from }, include: { rates: { orderBy: { order: "asc" } } }, orderBy: { name: "asc" } }),
      prisma.taxProfile.findMany({ where: { propertyId: to }, select: { name: true } }),
    ])
    const have = new Set(target.map((t) => t.name))
    return source.map((s) => ({
      key: s.name,
      label: s.name,
      detail: s.rates.map((r) => `${r.name} ${r.ratePercent}%`).join(" + ") || null,
      exists: have.has(s.name),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.taxProfile.findMany({ where: { propertyId: ctx.from } })
    for (const s of source) {
      if (!keys.has(s.name)) continue
      const exists = await tx.taxProfile.findFirst({ where: { propertyId: ctx.to, name: s.name }, select: { id: true } })
      if (exists) {
        ctx.report.skipped.push({ key: s.name, label: s.name })
        continue
      }
      await ensureTaxProfile(tx, ctx, s.id, false)
    }
  },
}

async function ensureChargeGroup(tx: Tx, ctx: CopyCtx, sourceGroupId: string): Promise<string> {
  const g = await tx.chargeGroup.findUniqueOrThrow({ where: { id: sourceGroupId } })
  const existing = await tx.chargeGroup.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: g.code } }, select: { id: true } })
  if (existing) return existing.id
  const created = await tx.chargeGroup.create({
    data: {
      enterpriseId: ctx.enterpriseId, propertyId: ctx.to, code: g.code, name: g.name, reportBucket: g.reportBucket,
      isRevenue: g.isRevenue, isSystem: g.isSystem, sortOrder: g.sortOrder,
    },
  })
  ctx.report.pulled.push({ key: g.code, label: `Charge group ${g.code} ${g.name}` })
  return created.id
}

async function ensureChargeSubgroup(tx: Tx, ctx: CopyCtx, sourceSubgroupId: string): Promise<string> {
  const sg = await tx.chargeSubgroup.findUniqueOrThrow({ where: { id: sourceSubgroupId } })
  const existing = await tx.chargeSubgroup.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: sg.code } }, select: { id: true } })
  if (existing) return existing.id
  const groupId = await ensureChargeGroup(tx, ctx, sg.chargeGroupId)
  // An outlet subgroup keeps its outlet only when that outlet was copied in this run —
  // otherwise the outlet is physically the source property's and the copy carries none.
  // A copied outlet already got a subgroup of its own when it was created (see outlets
  // below), and an outlet owns one subgroup — so this one then arrives unowned.
  const mappedOutletId = sg.outletId ? ctx.outletMap.get(sg.outletId) ?? null : null
  const outletId =
    mappedOutletId && !(await tx.chargeSubgroup.findFirst({ where: { outletId: mappedOutletId }, select: { id: true } }))
      ? mappedOutletId
      : null
  const created = await tx.chargeSubgroup.create({
    data: { enterpriseId: ctx.enterpriseId, propertyId: ctx.to, chargeGroupId: groupId, code: sg.code, name: sg.name, isSystem: sg.isSystem, sortOrder: sg.sortOrder, outletId },
  })
  ctx.report.pulled.push({ key: sg.code, label: `Charge subgroup ${sg.code} ${sg.name}` })
  return created.id
}

/** The target's id for a source charge code — copying it (and what it needs) when missing. */
async function ensureChargeCode(tx: Tx, ctx: CopyCtx, sourceCodeId: string, pulled: boolean): Promise<{ id: string; created: boolean }> {
  const c = await tx.chargeCode.findUniqueOrThrow({ where: { id: sourceCodeId } })
  const existing = await tx.chargeCode.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: c.code } }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }
  const chargeSubgroupId = await ensureChargeSubgroup(tx, ctx, c.chargeSubgroupId)
  const taxProfileId = c.taxProfileId ? await ensureTaxProfile(tx, ctx, c.taxProfileId, true) : null
  const created = await tx.chargeCode.create({
    data: {
      enterpriseId: ctx.enterpriseId, propertyId: ctx.to, code: c.code, description: c.description, chargeSubgroupId,
      postingType: c.postingType, isSystem: c.isSystem, isActive: c.isActive, useDefaultTax: c.useDefaultTax, taxProfileId,
    },
  })
  ;(pulled ? ctx.report.pulled : ctx.report.copied).push({ key: c.code, label: `${c.code} ${c.description}` })
  return { id: created.id, created: true }
}

const chargeCodes: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.chargeCode.findMany({
        where: { propertyId: from },
        include: { chargeSubgroup: { select: { code: true, name: true } } },
        orderBy: { code: "asc" },
      }),
      prisma.chargeCode.findMany({ where: { propertyId: to }, select: { code: true } }),
    ])
    const have = new Set(target.map((t) => t.code))
    return source.map((s) => ({
      key: s.code,
      label: `${s.code} ${s.description}`,
      detail: `${s.chargeSubgroup.code} ${s.chargeSubgroup.name}${s.isActive ? "" : " · inactive"}`,
      exists: have.has(s.code),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.chargeCode.findMany({ where: { propertyId: ctx.from }, orderBy: { code: "asc" } })
    const copiedSourceIds: string[] = []
    for (const c of source) {
      if (!keys.has(c.code)) continue
      const { created } = await ensureChargeCode(tx, ctx, c.id, false)
      if (created) copiedSourceIds.push(c.id)
      else ctx.report.skipped.push({ key: c.code, label: `${c.code} ${c.description}` })
    }
    // What a copied code GENERATES (tax, service charge, ...) comes with it — a code that
    // silently stopped generating its tax would post wrong totals.
    const generates = await tx.chargeCodeGenerate.findMany({
      where: { propertyId: ctx.from, generatorCodeId: { in: copiedSourceIds } },
      orderBy: { sortOrder: "asc" },
    })
    // Two passes: a generate calculated on ANOTHER generate needs that one's new id, and
    // sortOrder (ties at the default 10, or edited) says nothing about which comes first.
    const generateIdMap = new Map<string, string>()
    const created: { source: (typeof generates)[number]; id: string }[] = []
    for (const g of generates) {
      const generator = await ensureChargeCode(tx, ctx, g.generatorCodeId, true)
      const generated = await ensureChargeCode(tx, ctx, g.generatedCodeId, true)
      const exists = await tx.chargeCodeGenerate.findUnique({
        where: { generatorCodeId_generatedCodeId: { generatorCodeId: generator.id, generatedCodeId: generated.id } },
        select: { id: true },
      })
      if (exists) {
        generateIdMap.set(g.id, exists.id)
        continue
      }
      const row = await tx.chargeCodeGenerate.create({
        data: {
          enterpriseId: ctx.enterpriseId, propertyId: ctx.to, generatorCodeId: generator.id, generatedCodeId: generated.id,
          method: g.method, value: g.value, calculateOn: g.calculateOn, sortOrder: g.sortOrder, isActive: g.isActive,
          basisGenerateId: null,
        },
      })
      generateIdMap.set(g.id, row.id)
      created.push({ source: g, id: row.id })
    }
    for (const { source: g, id } of created) {
      if (!g.basisGenerateId && g.calculateOn !== "ANOTHER_GENERATE") continue
      const basis = g.basisGenerateId ? generateIdMap.get(g.basisGenerateId) : undefined
      // A basis that didn't come across falls back to NET, as deleting a basis does —
      // never ANOTHER_GENERATE with no basis, which posts 0.
      await tx.chargeCodeGenerate.update({
        where: { id },
        data: basis ? { basisGenerateId: basis } : { basisGenerateId: null, calculateOn: "NET" },
      })
    }
  },
}

const paymentMethods: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.paymentMethod.findMany({ where: { propertyId: from }, include: { chargeCode: { select: { code: true } } }, orderBy: { name: "asc" } }),
      prisma.paymentMethod.findMany({ where: { propertyId: to }, select: { name: true } }),
    ])
    const have = new Set(target.map((t) => t.name))
    return source.map((s) => ({
      key: s.name,
      label: s.name,
      detail: [s.type.replace(/_/g, " ").toLowerCase(), s.chargeCode ? `posts to ${s.chargeCode.code}` : null, s.isActive ? null : "inactive"]
        .filter(Boolean)
        .join(" · "),
      exists: have.has(s.name),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.paymentMethod.findMany({ where: { propertyId: ctx.from } })
    for (const m of source) {
      if (!keys.has(m.name)) continue
      const exists = await tx.paymentMethod.findFirst({ where: { propertyId: ctx.to, name: m.name }, select: { id: true } })
      if (exists) {
        ctx.report.skipped.push({ key: m.name, label: m.name })
        continue
      }
      const chargeCodeId = m.chargeCodeId ? (await ensureChargeCode(tx, ctx, m.chargeCodeId, true)).id : null
      await tx.paymentMethod.create({
        data: { enterpriseId: ctx.enterpriseId, propertyId: ctx.to, name: m.name, type: m.type, isActive: m.isActive, chargeCodeId },
      })
      ctx.report.copied.push({ key: m.name, label: m.name })
    }
  },
}

// Document wording — copied field by field, and only into a field the target has left
// empty: a field the target has filled in is its own wording and is skipped.
export const STATIONERY_FIELDS = {
  invoiceHeaderText: "Invoice header",
  invoiceFooterText: "Invoice footer",
  invoicePaymentTerms: "Invoice payment terms",
  invoicePaymentAccountName: "Bank account name",
  invoicePaymentAccountNumber: "Bank account number",
  invoicePaymentIban: "IBAN",
  invoicePaymentBankInfo: "Bank details",
  receiptFooterText: "Receipt footer",
  receiptTerms: "Receipt terms",
  statementFooterText: "Statement footer",
  statementTerms: "Statement terms",
  confirmationLetterMessage: "Confirmation letter message",
  registrationCardMessage: "Registration card message",
  registrationCardTerms: "Registration card terms",
  eRegistrationMessage: "eRegistration message",
} as const satisfies Partial<Record<keyof PropertySettingsValues, string>>
type StationeryField = keyof typeof STATIONERY_FIELDS

const filled = (v: unknown) => typeof v === "string" && v.trim() !== ""

const stationery: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([getPropertySettings(from), getPropertySettings(to)])
    return (Object.keys(STATIONERY_FIELDS) as StationeryField[])
      .filter((f) => filled(source[f]))
      .map((f) => {
        const text = String(source[f])
        return { key: f, label: STATIONERY_FIELDS[f], detail: text.length > 80 ? `${text.slice(0, 80)}…` : text, exists: filled(target[f]) }
      })
  },
  async copy(tx, ctx, keys) {
    const [source, target] = await Promise.all([getPropertySettings(ctx.from, tx), getPropertySettings(ctx.to, tx)])
    const data: Partial<Record<StationeryField, string>> = {}
    for (const f of Object.keys(STATIONERY_FIELDS) as StationeryField[]) {
      if (!keys.has(f) || !filled(source[f])) continue
      if (filled(target[f])) {
        ctx.report.skipped.push({ key: f, label: STATIONERY_FIELDS[f] })
        continue
      }
      data[f] = String(source[f])
      ctx.report.copied.push({ key: f, label: STATIONERY_FIELDS[f] })
    }
    if (Object.keys(data).length > 0) {
      await tx.propertySettings.upsert({ where: { propertyId: ctx.to }, update: data, create: { propertyId: ctx.to, ...data } })
    }
  },
}


// ─── Revenue: allocations and meal plans ─────────────────────────────────────────────

async function ensureAllocation(tx: Tx, ctx: CopyCtx, sourceId: string, pulled: boolean): Promise<{ id: string; created: boolean }> {
  const a = await tx.allocation.findUniqueOrThrow({ where: { id: sourceId }, include: { rates: { orderBy: { effectiveFrom: "asc" } } } })
  const existing = await tx.allocation.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: a.code } }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }
  const chargeCodeId = (await ensureChargeCode(tx, ctx, a.chargeCodeId, true)).id
  const created = await tx.allocation.create({
    data: {
      propertyId: ctx.to, code: a.code, name: a.name, type: a.type, chargeCodeId, postingRhythm: a.postingRhythm,
      mode: a.mode, sellSeparate: a.sellSeparate, publishToApi: a.publishToApi, isActive: a.isActive,
      // Its dated price rows come with it — an allocation with no rate covering the
      // audit night posts nothing, so copying it bare would silently price at zero.
      rates: a.rates.length
        ? {
            create: a.rates.map((r) => ({
              adultPrice: r.adultPrice, childPrice: r.childPrice, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
            })),
          }
        : undefined,
    },
  })
  ;(pulled ? ctx.report.pulled : ctx.report.copied).push({ key: a.code, label: `Allocation ${a.code} ${a.name}` })
  return { id: created.id, created: true }
}

const mealPlans: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.mealPlan.findMany({ where: { propertyId: from }, include: { allocationLinks: { include: { allocation: { select: { code: true } } } } }, orderBy: { code: "asc" } }),
      prisma.mealPlan.findMany({ where: { propertyId: to }, select: { code: true } }),
    ])
    const have = new Set(target.map((t) => t.code))
    return source.map((s) => ({
      key: s.code,
      label: `${s.code} ${s.name}`,
      detail: s.allocationLinks.length ? `includes ${s.allocationLinks.map((l) => l.allocation.code).join(", ")}` : null,
      exists: have.has(s.code),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.mealPlan.findMany({ where: { propertyId: ctx.from }, include: { allocationLinks: true }, orderBy: { code: "asc" } })
    for (const m of source) {
      if (!keys.has(m.code)) continue
      const exists = await tx.mealPlan.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: m.code } }, select: { id: true } })
      if (exists) {
        ctx.report.skipped.push({ key: m.code, label: `${m.code} ${m.name}` })
        continue
      }
      const plan = await tx.mealPlan.create({ data: { propertyId: ctx.to, code: m.code, name: m.name, isActive: m.isActive } })
      // What the plan includes comes with it.
      for (const link of m.allocationLinks) {
        const allocation = await ensureAllocation(tx, ctx, link.allocationId, true)
        await tx.mealPlanAllocation.create({ data: { mealPlanId: plan.id, allocationId: allocation.id } })
      }
      ctx.report.copied.push({ key: m.code, label: `${m.code} ${m.name}` })
    }
  },
}

// ─── Inventory: room types ───────────────────────────────────────────────────────────

const roomTypes: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.roomType.findMany({ where: { propertyId: from }, orderBy: { code: "asc" } }),
      prisma.roomType.findMany({ where: { propertyId: to }, select: { code: true } }),
    ])
    const have = new Set(target.map((t) => t.code))
    return source.map((s) => ({
      key: s.code,
      label: `${s.code} ${s.name}`,
      detail: [`sleeps ${s.maxOccupancy}`, s.isPseudo ? "PM room type" : null, s.isActive ? null : "inactive"].filter(Boolean).join(" · "),
      exists: have.has(s.code),
    }))
  },
  async copy(tx, ctx, keys) {
    // The room TYPE only — its rooms are physical, and each property builds its own.
    const source = await tx.roomType.findMany({ where: { propertyId: ctx.from }, include: { features: true }, orderBy: { code: "asc" } })
    for (const rt of source) {
      if (!keys.has(rt.code)) continue
      const exists = await tx.roomType.findFirst({ where: { propertyId: ctx.to, code: rt.code }, select: { id: true } })
      if (exists) {
        ctx.report.skipped.push({ key: rt.code, label: `${rt.code} ${rt.name}` })
        continue
      }
      await tx.roomType.create({
        data: {
          propertyId: ctx.to, code: rt.code, name: rt.name, maxOccupancy: rt.maxOccupancy, baseOccupancy: rt.baseOccupancy,
          description: rt.description, isActive: rt.isActive, isPseudo: rt.isPseudo, housekeepingEnabled: rt.housekeepingEnabled,
          features: { create: rt.features.map((f) => ({ category: f.category, code: f.code })) },
        },
      })
      ctx.report.copied.push({ key: rt.code, label: `${rt.code} ${rt.name}` })
      // A feature is a code in the property's own room-feature lists — bring any option
      // the target's lists lack, so the room type shows the same labels there.
      for (const f of rt.features) {
        const has = await tx.systemCode.findFirst({ where: { propertyId: ctx.to, category: f.category, code: f.code }, select: { id: true } })
        if (has) continue
        const option = await tx.systemCode.findFirst({ where: { propertyId: ctx.from, category: f.category, code: f.code } })
        if (!option) continue
        await tx.systemCode.create({
          data: { enterpriseId: ctx.enterpriseId, propertyId: ctx.to, category: option.category, code: option.code, value: option.value, sortOrder: option.sortOrder, isActive: option.isActive },
        })
        ctx.report.pulled.push({ key: listKey(option.category, option.code), label: `${option.value} (${option.category.replace(/_/g, " ").toLowerCase()})` })
      }
    }
  },
}

// ─── Outlets ─────────────────────────────────────────────────────────────────────────

const outlets: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.outlet.findMany({ where: { propertyId: from }, include: { _count: { select: { chargeCodes: true } } }, orderBy: { name: "asc" } }),
      prisma.outlet.findMany({ where: { propertyId: to }, select: { name: true, code: true } }),
    ])
    const names = new Set(target.map((t) => t.name))
    const codes = new Set(target.map((t) => t.code).filter(Boolean))
    return source.map((s) => ({
      key: s.name,
      label: s.code ? `${s.name} (${s.code})` : s.name,
      detail: [s.outletType.replace(/_/g, " ").toLowerCase(), `${s._count.chargeCodes} charge code${s._count.chargeCodes === 1 ? "" : "s"}`].join(" · "),
      exists: names.has(s.name) || (!!s.code && codes.has(s.code)),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.outlet.findMany({
      where: { propertyId: ctx.from },
      include: { chargeCodes: { include: { chargeCode: { select: { code: true, description: true, chargeSubgroup: { select: { code: true, outletId: true } } } } } } },
      orderBy: { name: "asc" },
    })
    for (const o of source) {
      if (!keys.has(o.name)) continue
      const exists = await tx.outlet.findFirst({
        where: { propertyId: ctx.to, OR: [{ name: o.name }, ...(o.code ? [{ code: o.code }] : [])] },
        select: { id: true },
      })
      if (exists) {
        ctx.report.skipped.push({ key: o.name, label: o.name })
        continue
      }
      const taxProfileId = o.taxProfileId ? await ensureTaxProfile(tx, ctx, o.taxProfileId, true) : null
      // Contact details and the sales-check counter are the source outlet's own.
      const outlet = await tx.outlet.create({
        data: {
          propertyId: ctx.to, name: o.name, description: o.description, outletType: o.outletType, isActive: o.isActive,
          code: o.code, taxOverrideMode: o.taxOverrideMode, taxProfileId,
        },
      })
      ctx.outletMap.set(o.id, outlet.id)
      ctx.report.copied.push({ key: o.name, label: o.name })
      // A plain copy (owner, 2026-09-24): its codes keep their own numbers — numbering is
      // the property owner's, never renumbered or invented here. Its own subgroup comes
      // with it, pointing at the new outlet (ensureChargeSubgroup), when that subgroup's
      // number is free at the target. A number the target already uses is someone else's
      // code: skipped and reported, never linked — linking it would post this outlet's
      // sales under another outlet.
      const ownSubgroupCode = o.chargeCodes.find((l) => l.chargeCode.chargeSubgroup.outletId === o.id)?.chargeCode.chargeSubgroup.code
      const ownSubgroupTaken =
        !!ownSubgroupCode &&
        !!(await tx.chargeSubgroup.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: ownSubgroupCode } }, select: { id: true } }))
      for (const link of o.chargeCodes) {
        if (link.chargeCode.chargeSubgroup.outletId === o.id) {
          const numberTaken = !!(await tx.chargeCode.findUnique({
            where: { propertyId_code: { propertyId: ctx.to, code: link.chargeCode.code } },
            select: { id: true },
          }))
          if (ownSubgroupTaken || numberTaken) {
            const why = numberTaken ? `code ${link.chargeCode.code}` : `subgroup ${ownSubgroupCode}`
            ctx.report.skipped.push({
              key: link.chargeCode.code,
              label: `${link.chargeCode.code} ${link.chargeCode.description} (${o.name}) — ${why} is already used at this property`,
            })
            continue
          }
        }
        const code = await ensureChargeCode(tx, ctx, link.chargeCodeId, true)
        await tx.outletChargeCode.upsert({
          where: { outletId_chargeCodeId: { outletId: outlet.id, chargeCodeId: code.id } },
          update: {},
          create: { outletId: outlet.id, chargeCodeId: code.id },
        })
      }
    }
  },
}

// ─── Allocations (stand-alone) ───────────────────────────────────────────────────────

const allocations: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.allocation.findMany({ where: { propertyId: from }, include: { chargeCode: { select: { code: true } } }, orderBy: { code: "asc" } }),
      prisma.allocation.findMany({ where: { propertyId: to }, select: { code: true } }),
    ])
    const have = new Set(target.map((t) => t.code))
    return source.map((s) => ({
      key: s.code,
      label: `${s.code} ${s.name}`,
      detail: [s.type.toLowerCase(), `posts to ${s.chargeCode.code}`, s.isActive ? null : "inactive"].filter(Boolean).join(" · "),
      exists: have.has(s.code),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.allocation.findMany({ where: { propertyId: ctx.from }, orderBy: { code: "asc" } })
    for (const a of source) {
      if (!keys.has(a.code)) continue
      // With its dated rates, and its charge code pulled along — see ensureAllocation.
      const { created } = await ensureAllocation(tx, ctx, a.id, false)
      if (!created) ctx.report.skipped.push({ key: a.code, label: `Allocation ${a.code} ${a.name}` })
    }
  },
}

// ─── Spa catalogue ───────────────────────────────────────────────────────────────────
//
// Categories (unique by name), treatments (by name — they have no code) with their dated
// rates, the charge code they post to and the rooms they can use, treatment rooms (by name,
// or code) and the Spa settings. Therapists are the property's own people and never come.
// No outlet to map: the Spa outlet is enterprise-wide (EnterpriseSettings.spaOutletId), and
// neither a treatment nor SpaSettings points at one.

const spaKey = {
  category: (name: string) => `category:${name}`,
  treatment: (name: string) => `treatment:${name}`,
  room: (name: string) => `room:${name}`,
  settings: "settings",
}

async function ensureSpaCategory(tx: Tx, ctx: CopyCtx, sourceId: string, pulled: boolean): Promise<{ id: string; created: boolean }> {
  const c = await tx.spaTreatmentCategory.findUniqueOrThrow({ where: { id: sourceId } })
  const existing = await tx.spaTreatmentCategory.findUnique({ where: { propertyId_name: { propertyId: ctx.to, name: c.name } }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }
  const created = await tx.spaTreatmentCategory.create({
    data: { propertyId: ctx.to, name: c.name, description: c.description, displayOrder: c.displayOrder, isActive: c.isActive },
  })
  ;(pulled ? ctx.report.pulled : ctx.report.copied).push({ key: spaKey.category(c.name), label: `Treatment category ${c.name}` })
  return { id: created.id, created: true }
}

async function ensureSpaRoom(tx: Tx, ctx: CopyCtx, sourceId: string, pulled: boolean): Promise<{ id: string; created: boolean }> {
  const r = await tx.spaRoom.findUniqueOrThrow({ where: { id: sourceId } })
  const existing = await tx.spaRoom.findFirst({
    where: { propertyId: ctx.to, OR: [{ name: r.name }, ...(r.code ? [{ code: r.code }] : [])] },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }
  // The room only — its closures (availability exceptions) are dated and the source's own.
  const created = await tx.spaRoom.create({
    data: {
      propertyId: ctx.to, name: r.name, code: r.code, description: r.description, capacity: r.capacity, roomType: r.roomType,
      isActive: r.isActive, bookable: r.bookable, displayOrder: r.displayOrder,
    },
  })
  ;(pulled ? ctx.report.pulled : ctx.report.copied).push({ key: spaKey.room(r.name), label: `Treatment room ${r.name}` })
  return { id: created.id, created: true }
}

// Every SpaSettings field is operating policy (hours, slot interval, buffers, holds, charge
// timing, cancellation / no-show rules) — nothing in it links to another row — so the whole
// row copies as one item, and only to a property that has never saved its own.
const SPA_SETTINGS_FIELDS = [
  "defaultOpeningTime", "defaultClosingTime", "slotIntervalMinutes", "defaultPreparationBufferMinutes",
  "defaultCleanupBufferMinutes", "allowTentativeAppointments", "tentativeHoldMinutes", "requireTherapistAtBooking",
  "requireRoomAtBooking", "allowAutoAssignment", "chargeTiming", "cancellationCutoffHours", "lateCancellationChargeType",
  "lateCancellationChargeValue", "noShowChargeType", "noShowChargeValue", "noShowGraceMinutes", "requireCancellationReason",
  "requireRescheduleReason",
] as const satisfies readonly (keyof Prisma.SpaSettingsUncheckedCreateInput)[]

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const spa: SectionDef = {
  async preview(from, to) {
    const [categories, treatments, rooms, settings, tCategories, tTreatments, tRooms, tSettings] = await Promise.all([
      prisma.spaTreatmentCategory.findMany({
        where: { propertyId: from },
        include: { _count: { select: { treatments: true } } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
      prisma.spaTreatment.findMany({
        where: { propertyId: from },
        include: { category: { select: { name: true } }, chargeCode: { select: { code: true } }, _count: { select: { compatibleRooms: true } } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
      prisma.spaRoom.findMany({ where: { propertyId: from }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
      prisma.spaSettings.findUnique({ where: { propertyId: from } }),
      prisma.spaTreatmentCategory.findMany({ where: { propertyId: to }, select: { name: true } }),
      prisma.spaTreatment.findMany({ where: { propertyId: to }, select: { name: true } }),
      prisma.spaRoom.findMany({ where: { propertyId: to }, select: { name: true, code: true } }),
      prisma.spaSettings.findUnique({ where: { propertyId: to }, select: { propertyId: true } }),
    ])
    const haveCategory = new Set(tCategories.map((t) => t.name))
    const haveTreatment = new Set(tTreatments.map((t) => t.name))
    const roomNames = new Set(tRooms.map((t) => t.name))
    const roomCodes = new Set(tRooms.map((t) => t.code).filter(Boolean))
    const inactive = (active: boolean) => (active ? null : "inactive")
    const items: CopyPreviewItem[] = [
      ...categories.map((c) => ({
        key: spaKey.category(c.name),
        label: c.name,
        group: "Categories",
        detail: [plural(c._count.treatments, "treatment"), inactive(c.isActive)].filter(Boolean).join(" · "),
        exists: haveCategory.has(c.name),
      })),
      ...treatments.map((t) => ({
        key: spaKey.treatment(t.name),
        label: t.name,
        group: "Treatments",
        detail: [
          t.category.name,
          `${t.defaultDurationMinutes} min`,
          `posts to ${t.chargeCode.code}`,
          t._count.compatibleRooms ? plural(t._count.compatibleRooms, "room") : null,
          inactive(t.isActive),
        ].filter(Boolean).join(" · "),
        exists: haveTreatment.has(t.name),
      })),
      ...rooms.map((r) => ({
        key: spaKey.room(r.name),
        label: r.code ? `${r.name} (${r.code})` : r.name,
        group: "Treatment rooms",
        detail: [`capacity ${r.capacity}`, inactive(r.isActive)].filter(Boolean).join(" · "),
        exists: roomNames.has(r.name) || (!!r.code && roomCodes.has(r.code)),
      })),
    ]
    if (settings) {
      items.push({
        key: spaKey.settings,
        label: "Spa settings",
        group: "Settings",
        detail: `open ${settings.defaultOpeningTime}–${settings.defaultClosingTime} · ${settings.slotIntervalMinutes}-minute slots · cancellation and no-show policy`,
        exists: !!tSettings,
      })
    }
    return items
  },
  async copy(tx, ctx, keys) {
    // Categories and rooms first, so one ticked alongside a treatment counts as copied, not pulled along.
    const categories = await tx.spaTreatmentCategory.findMany({ where: { propertyId: ctx.from }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] })
    for (const c of categories) {
      if (!keys.has(spaKey.category(c.name))) continue
      const { created } = await ensureSpaCategory(tx, ctx, c.id, false)
      if (!created) ctx.report.skipped.push({ key: spaKey.category(c.name), label: `Treatment category ${c.name}` })
    }
    const rooms = await tx.spaRoom.findMany({ where: { propertyId: ctx.from }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] })
    for (const r of rooms) {
      if (!keys.has(spaKey.room(r.name))) continue
      const { created } = await ensureSpaRoom(tx, ctx, r.id, false)
      if (!created) ctx.report.skipped.push({ key: spaKey.room(r.name), label: `Treatment room ${r.name}` })
    }
    const treatments = await tx.spaTreatment.findMany({
      where: { propertyId: ctx.from },
      include: { rates: { orderBy: { effectiveFrom: "asc" } }, compatibleRooms: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    })
    for (const t of treatments) {
      const key = spaKey.treatment(t.name)
      if (!keys.has(key)) continue
      if (await tx.spaTreatment.findFirst({ where: { propertyId: ctx.to, name: t.name }, select: { id: true } })) {
        ctx.report.skipped.push({ key, label: `Treatment ${t.name}` })
        continue
      }
      const categoryId = (await ensureSpaCategory(tx, ctx, t.categoryId, true)).id
      const chargeCodeId = (await ensureChargeCode(tx, ctx, t.chargeCodeId, true)).id
      const treatment = await tx.spaTreatment.create({
        data: {
          propertyId: ctx.to, categoryId, chargeCodeId, name: t.name, shortName: t.shortName, description: t.description,
          defaultDurationMinutes: t.defaultDurationMinutes, preparationBufferMinutes: t.preparationBufferMinutes,
          cleanupBufferMinutes: t.cleanupBufferMinutes, maxParticipants: t.maxParticipants, pricingMode: t.pricingMode,
          allowWalkIn: t.allowWalkIn, allowInHouseGuest: t.allowInHouseGuest, displayOrder: t.displayOrder, isActive: t.isActive,
          // The guest-facing copy comes along; selling it online is the target property's
          // own choice, so it arrives unpublished (nothing goes online until someone chooses it).
          publishOnline: false, publicDescription: t.publicDescription, imageUrls: t.imageUrls, inclusions: t.inclusions,
          // Its dated prices come with it — a treatment with no rate can't be charged.
          rates: t.rates.length
            ? { create: t.rates.map((r) => ({ price: r.price, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isActive: r.isActive })) }
            : undefined,
        },
      })
      // The rooms it can be given come with it (pulled along where the target lacks them);
      // its therapists don't — they are the target property's people to qualify.
      for (const link of t.compatibleRooms) {
        const room = await ensureSpaRoom(tx, ctx, link.roomId, true)
        await tx.spaTreatmentRoom.create({ data: { treatmentId: treatment.id, roomId: room.id, preferred: link.preferred } })
      }
      ctx.report.copied.push({ key, label: `Treatment ${t.name}` })
    }
    if (keys.has(spaKey.settings)) {
      const source = await tx.spaSettings.findUnique({ where: { propertyId: ctx.from } })
      if (source) {
        if (await tx.spaSettings.findUnique({ where: { propertyId: ctx.to }, select: { propertyId: true } })) {
          ctx.report.skipped.push({ key: spaKey.settings, label: "Spa settings" })
        } else {
          const data = Object.fromEntries(SPA_SETTINGS_FIELDS.map((f) => [f, source[f]])) as Pick<typeof source, (typeof SPA_SETTINGS_FIELDS)[number]>
          await tx.spaSettings.create({ data: { propertyId: ctx.to, ...data } })
          ctx.report.copied.push({ key: spaKey.settings, label: "Spa settings" })
        }
      }
    }
  },
}

// ─── Excursion catalogue ─────────────────────────────────────────────────────────────
//
// Excursion types (by code) with their dated rates, their charge code (pulled along) and
// their recurring schedules. Departures and bookings are dated operations — never copied;
// the target generates its own departures from the copied schedules.

const excursions: SectionDef = {
  async preview(from, to) {
    const [source, target] = await Promise.all([
      prisma.excursionType.findMany({
        where: { propertyId: from },
        include: { chargeCode: { select: { code: true } }, _count: { select: { schedules: true } } },
        orderBy: { code: "asc" },
      }),
      prisma.excursionType.findMany({ where: { propertyId: to }, select: { code: true } }),
    ])
    const have = new Set(target.map((t) => t.code))
    return source.map((s) => ({
      key: s.code,
      label: `${s.code} ${s.name}`,
      detail: [
        s.pricingMode === "FLAT" ? "flat price" : "per person",
        `posts to ${s.chargeCode.code}`,
        plural(s._count.schedules, "schedule"),
        s.isActive ? null : "inactive",
      ].filter(Boolean).join(" · "),
      exists: have.has(s.code),
    }))
  },
  async copy(tx, ctx, keys) {
    const source = await tx.excursionType.findMany({
      where: { propertyId: ctx.from },
      include: { rates: { orderBy: { effectiveFrom: "asc" } }, schedules: { orderBy: { createdAt: "asc" } } },
      orderBy: { code: "asc" },
    })
    for (const e of source) {
      if (!keys.has(e.code)) continue
      const label = `${e.code} ${e.name}`
      if (await tx.excursionType.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: e.code } }, select: { id: true } })) {
        ctx.report.skipped.push({ key: e.code, label })
        continue
      }
      const chargeCodeId = (await ensureChargeCode(tx, ctx, e.chargeCodeId, true)).id
      await tx.excursionType.create({
        data: {
          propertyId: ctx.to, code: e.code, name: e.name, description: e.description, chargeCodeId, pricingMode: e.pricingMode,
          cutoffHours: e.cutoffHours, isActive: e.isActive,
          // Guest-facing copy comes along; it arrives unpublished — as Spa treatments above.
          publishOnline: false, publicDescription: e.publicDescription, imageUrls: e.imageUrls, inclusions: e.inclusions,
          rates: e.rates.length
            ? {
                create: e.rates.map((r) => ({
                  adultPrice: r.adultPrice, childPrice: r.childPrice, infantPrice: r.infantPrice, flatPrice: r.flatPrice,
                  effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
                })),
              }
            : undefined,
          schedules: e.schedules.length
            ? {
                create: e.schedules.map((s) => ({
                  daysOfWeek: s.daysOfWeek, departureTime: s.departureTime, meetingTime: s.meetingTime, meetingPoint: s.meetingPoint,
                  capacity: s.capacity, minCapacity: s.minCapacity, isActive: s.isActive,
                })),
              }
            : undefined,
        },
      })
      ctx.report.copied.push({ key: e.code, label })
    }
  },
}

const SECTIONS: Record<CopySection, SectionDef> = {
  lists,
  "tax-profiles": taxProfiles,
  "charge-codes": chargeCodes,
  "payment-methods": paymentMethods,
  stationery,
  "meal-plans": mealPlans,
  "room-types": roomTypes,
  outlets,
  allocations,
  spa,
  excursions,
}

// ─── Entry points ──────────────────────────────────────────────────────────────────

async function assertSameEnterprise(from: string, to: string): Promise<string> {
  if (from === to) throw new ForbiddenError("Choose a different property to copy from")
  const rows = await prisma.property.findMany({ where: { id: { in: [from, to] } }, select: { id: true, enterpriseId: true } })
  if (rows.length !== 2 || rows[0].enterpriseId !== rows[1].enterpriseId) throw new ForbiddenError("Property not found")
  return rows[0].enterpriseId
}

/** A Spa / Excursions section exists only for an enterprise that has that add-on. */
async function assertSectionAvailable(section: CopySection, enterpriseId: string): Promise<void> {
  const addon = SECTION_ADDON[section]
  if (addon && !(await loadHubAddons(enterpriseId)).has(addon)) {
    throw new ForbiddenError(`This enterprise doesn't have the ${addon === "SPA" ? "Spa" : "Excursions"} add-on`)
  }
}

/** What the source property has in this section, each marked with whether the target already does. */
export async function previewCopy(section: CopySection, from: string, to: string): Promise<CopyPreviewItem[]> {
  await assertSectionAvailable(section, await assertSameEnterprise(from, to))
  return SECTIONS[section].preview(from, to)
}

/** Copy the chosen items (by key) — everything the target already has is skipped, never overwritten. */
export async function runCopy(section: CopySection, from: string, to: string, keys: string[]): Promise<CopyReport> {
  const enterpriseId = await assertSameEnterprise(from, to)
  await assertSectionAvailable(section, enterpriseId)
  const report: CopyReport = { copied: [], skipped: [], pulled: [] }
  await prisma.$transaction(
    (tx) => SECTIONS[section].copy(tx, { from, to, enterpriseId, report, outletMap: new Map() }, new Set(keys)),
    { timeout: 30_000 }
  )
  return report
}
