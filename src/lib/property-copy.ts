import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { ForbiddenError } from "@/lib/scope"
import { getPropertySettings, type PropertySettingsValues } from "@/lib/property-settings"
import { PROPERTY_LIST_CATEGORIES } from "@/lib/system-code-scope"
import { provisionOutletSubgroup } from "@/lib/posting/outlet-subgroup"

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
// subgroup keeps its outlet only when that outlet is copied in the same run.

export const COPY_SECTIONS = [
  "lists",
  "tax-profiles",
  "charge-codes",
  "payment-methods",
  "stationery",
  "meal-plans",
  "room-types",
  "outlets",
] as const
export type CopySection = (typeof COPY_SECTIONS)[number]

export function isCopySection(value: string): value is CopySection {
  return (COPY_SECTIONS as readonly string[]).includes(value)
}

/** One source item, and whether the target already has it (so it would be skipped). */
export type CopyPreviewItem = { key: string; label: string; detail: string | null; exists: boolean }
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
  const a = await tx.allocation.findUniqueOrThrow({ where: { id: sourceId } })
  const existing = await tx.allocation.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: a.code } }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }
  const chargeCodeId = (await ensureChargeCode(tx, ctx, a.chargeCodeId, true)).id
  const created = await tx.allocation.create({
    data: {
      propertyId: ctx.to, code: a.code, name: a.name, type: a.type, chargeCodeId, postingRhythm: a.postingRhythm,
      mode: a.mode, sellSeparate: a.sellSeparate, publishToApi: a.publishToApi, isActive: a.isActive,
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
      // Its own subgroup comes with it, pointing at the new outlet (ensureChargeSubgroup) —
      // but only when that subgroup's number is free at the target. Every property's first
      // restaurant is 20RV / 2001-2004, so matching by number would hand the copy ANOTHER
      // outlet's codes and its sales would post under that outlet: those are reported as
      // skipped, and the outlet gets a fresh subgroup of its own, as creating it would.
      const ownSubgroupCode = o.chargeCodes.find((l) => l.chargeCode.chargeSubgroup.outletId === o.id)?.chargeCode.chargeSubgroup.code
      const ownTaken =
        !!ownSubgroupCode &&
        !!(await tx.chargeSubgroup.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: ownSubgroupCode } }, select: { id: true } }))
      for (const link of o.chargeCodes) {
        const own = link.chargeCode.chargeSubgroup.outletId === o.id
        const numberTaken =
          own && !!(await tx.chargeCode.findUnique({ where: { propertyId_code: { propertyId: ctx.to, code: link.chargeCode.code } }, select: { id: true } }))
        if (own && (ownTaken || numberTaken)) {
          ctx.report.skipped.push({ key: link.chargeCode.code, label: `${link.chargeCode.code} ${link.chargeCode.description} (number already used at this property)` })
          continue
        }
        const code = await ensureChargeCode(tx, ctx, link.chargeCodeId, true)
        await tx.outletChargeCode.upsert({
          where: { outletId_chargeCodeId: { outletId: outlet.id, chargeCodeId: code.id } },
          update: {},
          create: { outletId: outlet.id, chargeCodeId: code.id },
        })
      }
      if (!(await tx.chargeSubgroup.findFirst({ where: { outletId: outlet.id }, select: { id: true } }))) {
        await provisionOutletSubgroup(tx, {
          enterpriseId: ctx.enterpriseId, propertyId: ctx.to, outletId: outlet.id, outletName: outlet.name, outletType: outlet.outletType,
        })
      }
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
}

// ─── Entry points ──────────────────────────────────────────────────────────────────

async function assertSameEnterprise(from: string, to: string): Promise<string> {
  if (from === to) throw new ForbiddenError("Choose a different property to copy from")
  const rows = await prisma.property.findMany({ where: { id: { in: [from, to] } }, select: { id: true, enterpriseId: true } })
  if (rows.length !== 2 || rows[0].enterpriseId !== rows[1].enterpriseId) throw new ForbiddenError("Property not found")
  return rows[0].enterpriseId
}

/** What the source property has in this section, each marked with whether the target already does. */
export async function previewCopy(section: CopySection, from: string, to: string): Promise<CopyPreviewItem[]> {
  await assertSameEnterprise(from, to)
  return SECTIONS[section].preview(from, to)
}

/** Copy the chosen items (by key) — everything the target already has is skipped, never overwritten. */
export async function runCopy(section: CopySection, from: string, to: string, keys: string[]): Promise<CopyReport> {
  const enterpriseId = await assertSameEnterprise(from, to)
  const report: CopyReport = { copied: [], skipped: [], pulled: [] }
  await prisma.$transaction(
    (tx) => SECTIONS[section].copy(tx, { from, to, enterpriseId, report, outletMap: new Map() }, new Set(keys)),
    { timeout: 30_000 }
  )
  return report
}
