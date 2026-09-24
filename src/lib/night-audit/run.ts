import { NextResponse } from "next/server"
import { getPropertySettings } from "@/lib/property-settings"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { assertPropertyAccess, type AuthContext } from "@/lib/scope"
import { postCharge } from "@/lib/posting/post-charge"
import { postStayNight, STAY_NIGHT_INCLUDE, type StayNightContext } from "@/lib/night-audit/stay-night"
import { resolveChargeCode, MissingChargeCodeError } from "@/lib/posting/resolve-charge-code"
import type { GenerateRow } from "@/lib/posting/run-generates"
import { resolveBusinessDate, nextBusinessDate } from "@/lib/business-date"
import { getFeeRuleById, computeReservationFee } from "@/lib/fee-rules"
import { applyEodHousekeepingShift } from "@/lib/eod-housekeeping"
import { logActivity } from "@/lib/activity-log"

// The Night Audit itself — posts the audited business date's room charges, allocations,
// taxes, transport and no-show charges, marks no-shows, shifts housekeeping statuses and
// rolls the business date forward. Moved out of POST /api/night-audit/run so it can also
// run WITHOUT a signed-in user: the scheduled audit (src/lib/night-audit/scheduled.ts)
// calls it with a system context. The caller checks the permission; this checks that the
// property is the caller's.
export type NightAuditInput = { propertyId?: string; confirmed?: boolean; reason?: string }

export async function runNightAudit(ctx: AuthContext, body: NightAuditInput): Promise<NextResponse> {
  const propertyId = body.propertyId
  const confirmed = body.confirmed === true
  const overrideReason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (!propertyId) {
    return NextResponse.json({ error: "Property ID required" }, { status: 400 })
  }
  await assertPropertyAccess(ctx, propertyId)

  const property = await prisma.property.findUnique({ where: { id: propertyId } })
  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 })
  }

  // Who ran the audit is derived from the session, never a client-supplied string.
  const runByUser = await prisma.user.findUnique({ where: { id: ctx.userId } })
  const executedBy = runByUser ? `${runByUser.firstName} ${runByUser.lastName}` : ctx.userId

  // The business date being audited is the PROPERTY's own business date (UTC
  // midnight) — the operational "today". Night Audit posts every charge on it and,
  // on success, rolls it forward one day (the manual EOD roll). This is the single
  // source of truth for the posting/revenue date; EnterpriseSettings.systemDate is
  // left as the real server date and is no longer touched here.
  const auditDate = resolveBusinessDate(property)
  const nextDay = nextBusinessDate(auditDate)

  // Idempotency guard: one successful audit per property per business date. Without
  // this, a double-click or an impatient retry double-posted every room charge,
  // allocation, and Green Tax line.
  const alreadyRun = await prisma.propertyNightAuditLog.findFirst({
    where: {
      propertyId,
      status: "COMPLETED",
      auditDate: { gte: auditDate, lt: nextDay },
    },
  })
  // Recency guard: EOD normally runs once a day. Running it again within 12 hours
  // of the last successful run advances the business date a second time (a common
  // accidental double-run), so it requires an explicit confirmation + a logged
  // reason. Distinct from the same-business-date idempotency guard above.
  const lastCompleted = await prisma.propertyNightAuditLog.findFirst({
    where: { propertyId, status: "COMPLETED" },
    orderBy: { executedAt: "desc" },
  })
  if (lastCompleted) {
    const hoursSince = (Date.now() - lastCompleted.executedAt.getTime()) / 3_600_000
    if (hoursSince < 12) {
      if (!confirmed) {
        return NextResponse.json(
          {
            error: `End-of-Day was last run ${hoursSince < 1 ? `${Math.round(hoursSince * 60)} minutes` : `${hoursSince.toFixed(1)} hours`} ago. Running it again will advance the business date another day.`,
            requiresConfirmation: true,
            lastRunAt: lastCompleted.executedAt,
            hoursSince: Math.round(hoursSince * 10) / 10,
          },
          { status: 409 }
        )
      }
      if (!overrideReason) {
        return NextResponse.json({ error: "A reason is required to run End-of-Day again within 12 hours." }, { status: 400 })
      }
      // Log the deliberate override up front so the reason is on the trail even if
      // the run itself later fails.
      await logActivity({
        ctx,
        module: "NIGHT_AUDIT",
        action: "EOD_OVERRIDE",
        entityType: "Property",
        entityId: propertyId,
        description: `Ran End-of-Day again ${hoursSince.toFixed(1)}h after the last run — reason: "${overrideReason}"`,
      })
    }
  }

  if (alreadyRun) {
    return NextResponse.json(
      { error: `Night audit has already been run for ${auditDate.toISOString().slice(0, 10)}.`, log: alreadyRun },
      { status: 409 }
    )
  }

  // This property's own posting defaults and tax configuration.
  const settings = await getPropertySettings(property.id)

  // Accommodation charge code the nightly room charge posts against, resolved per
  // reservation in the loop as: the reservation's rate plan's own chargeCode -> the
  // role-resolved enterprise accommodation code. The role lookup replaces the old
  // literal `code: "ROOM"` findFirst — see src/lib/posting/resolve-charge-code.ts.
  const taxInclude = { taxProfile: { include: { rates: true } } } as const
  const fallbackRoomCode = await resolveChargeCode({ propertyId: property.id }, "ACCOMMODATION", { settings })

  if (!fallbackRoomCode) {
    return NextResponse.json(
      { error: new MissingChargeCodeError("ACCOMMODATION").message },
      { status: 400 }
    )
  }

  // The property's system-provisioned Base Rate plan (see RatePlan.isLocked,
  // created at onboarding by api/properties/route.ts) — the default price for any
  // room type/date when the reservation's own assigned rate plan has no Price
  // Calendar entry for tonight. Replaces the old flat RoomType.basePrice fallback.
  const baseRatePlan = await prisma.ratePlan.findFirst({ where: { propertyId, isLocked: true } })

  // Green Tax (Maldives): a flat per-adult/per-child nightly government levy, separate
  // from GST/service charge and unaffected by the property's tax-inclusive toggle.
  // Infants (Reservation.infants) are exempt and not counted.
  //
  // It is no longer a hardcoded branch below: it posts as a ChargeCodeGenerate off the
  // room charge (CHARGE_CODE_PLAN.md §4), through the same postCharge path as every
  // other line, so a property can add a bed tax or municipal levy in Controls without
  // new code. The *rates* still come from the enterprise's Maldives Tax config — the
  // GREEN_TAX generate method reads EnterpriseSettings.greenTax*, so Controls >
  // Finance > Tax stays the one place they're edited.
  //
  // `impliedGreenTaxGenerate` covers accommodation codes that carry no Green Tax row
  // of their own (a per-rate-plan code, or an enterprise seeded before the hierarchy):
  // Green Tax is a rule about accommodation, not about one code, and a missing row
  // must not silently drop the levy. A row stored on the code always wins.
  const greenTaxEnabled = settings?.greenTaxEnabled ?? false
  let gtxCode = null
  if (greenTaxEnabled) {
    gtxCode = await resolveChargeCode({ propertyId: property.id }, "GREEN_TAX", { settings })
    if (!gtxCode) {
      return NextResponse.json({ error: "Missing GTX charge code in system settings. Add a Green Tax charge code in the Hub (Charge Codes)." }, { status: 400 })
    }
  }
  const impliedGreenTaxGenerate: GenerateRow[] = gtxCode
    ? [{
        id: `implied-green-tax:${gtxCode.id}`,
        generatedCodeId: gtxCode.id,
        method: "GREEN_TAX",
        value: 0,
        calculateOn: "NET",
        basisGenerateId: null,
        sortOrder: 1000,
        isActive: true,
      }]
    : []

  // 1. Fetch all currently checked-in reservations
  const activeReservations = await prisma.reservation.findMany({
    where: {
      propertyId,
      status: "IN_HOUSE"
    },
    include: STAY_NIGHT_INCLUDE,
  })

  const pricesIncludeTaxes = property.pricesIncludeTaxes
  // Every posted line is stamped with the business date being audited (the
  // property's operational "today"), not wall-clock — so posting/revenue dates
  // track the business date and a late-night audit still books to the right day.
  const today = auditDate

  // Overstays: IN_HOUSE reservations whose checkOutDate is today or earlier. They
  // should have been checked out — deliberately NOT charged another room night here
  // (unbounded auto-accrual for a forgotten checkout is worse than an under-charge a
  // human can fix), but surfaced in the response so front office deals with them.
  const overstays = activeReservations.filter((r) => r.checkOutDate <= auditDate)
  const chargeableReservations = activeReservations.filter((r) => r.checkOutDate > auditDate)

  // Arrivals that never checked in by audit time are marked NO_SHOW inside the
  // transaction below — WHEN is the property's choice (Hub > Night Audit > No-Shows):
  //   FIRST_AUDIT  — at the audit of the arrival night (arrival on or before tonight);
  //   SECOND_AUDIT — held one night so a late arrival can still check in (arrival before
  //                  tonight), then marked;
  //   MANUAL       — never here; they stay pending arrivals until the desk decides.
  // Each no-show's fee comes from ITS OWN selected NO_SHOW rule
  // (Reservation.noShowFeeRuleId) — no selection means no fee — and is posted only when
  // the property has "post the no-show fee" on. When a fee applies it is ALWAYS posted to
  // a folio (created if the reservation has none) so it carries into billing (owner rule
  // 2026-07-24), on the audit date.
  const noShowCutoff = settings.noShowTiming === "SECOND_AUDIT" ? auditDate : nextDay
  const noShowCandidates =
    settings.noShowTiming === "MANUAL"
      ? []
      : await prisma.reservation.findMany({
          where: { propertyId, status: "RESERVED", checkInDate: { lt: noShowCutoff } },
          include: { assignments: true, folios: { include: { payments: true } } },
        })
  // Arrivals due by tonight that were NOT marked (held a night, or left for the desk) —
  // reported so nobody forgets them.
  const heldArrivals = await prisma.reservation.findMany({
    where: { propertyId, status: "RESERVED", checkInDate: { lt: nextDay }, id: { notIn: noShowCandidates.map((r) => r.id) } },
    select: { confirmationNo: true },
  })

  type NoShowFee = { reservationId: string; confirmationNo: string; fee: number; chargeCodeId: string; folioId: string | null; hadFolio: boolean }
  const noShowFees: NoShowFee[] = []
  for (const r of settings.noShowPostFee ? noShowCandidates : []) {
    const rule = await getFeeRuleById(r.noShowFeeRuleId, "NO_SHOW")
    if (!rule || !rule.chargeCodeId) continue
    const fee = await computeReservationFee(rule, r)
    if (fee > 0.005) {
      const openFolio = r.folios.find((f) => !f.isClosed) ?? r.folios[0] ?? null
      noShowFees.push({ reservationId: r.id, confirmationNo: r.confirmationNo, fee, chargeCodeId: rule.chargeCodeId, folioId: openFolio?.id ?? null, hadFolio: !!openFolio })
    }
  }

  // The fee rules' charge codes, in the postCharge shape, loaded once.
  const noShowCodeMap = new Map(
    (noShowFees.length
      ? await prisma.chargeCode.findMany({
          where: { id: { in: [...new Set(noShowFees.map((f) => f.chargeCodeId))] }, propertyId: property.id },
          include: taxInclude,
        })
      : []
    ).map((c) => [c.id, c])
  )

  let totalRoomRevenue = 0
  let totalTaxPosted = 0
  let totalPostings = 0

  // Reservations whose nightly rate resolved to $0 with no override — almost always
  // a Price Calendar coverage gap (the Base plan only covers dates it was actually
  // bulk-priced for), i.e. silently lost revenue. Posted anyway (matching existing
  // behavior) but called out in the response.
  const zeroRateConfirmationNos: string[] = []

  // Standing routing rules for the reservations being audited — pre-fetched once so
  // the posting loop can redirect a charge by code without a per-line DB read.
  // Keyed `${reservationId}:${chargeCodeId}` → target folio id (skipping closed targets).
  const chargeableIds = chargeableReservations.map((r) => r.id)
  const routingRuleRows = chargeableIds.length > 0
    ? await prisma.folioRoutingRule.findMany({
        where: { reservationId: { in: chargeableIds } },
        include: { targetFolio: { select: { id: true, isClosed: true } } },
      })
    : []
  const routingMap = new Map<string, string>()
  for (const rule of routingRuleRows) {
    if (rule.targetFolio && !rule.targetFolio.isClosed) {
      routingMap.set(`${rule.reservationId}:${rule.chargeCodeId}`, rule.targetFolioId)
    }
  }
  const routeTo = (reservationId: string, chargeCodeId: string, defaultFolioId: string) =>
    routingMap.get(`${reservationId}:${chargeCodeId}`) ?? defaultFolioId

  // Group pickups default-route their charges to the block's master folio (the PM
  // account), unless the pickup opted out (groupBillToMaster=false). An explicit
  // FolioRoutingRule still wins over this via routeTo above.
  const groupBlockIds = [...new Set(activeReservations.map((r) => r.groupBlockId).filter(Boolean))] as string[]
  const masterFolios = groupBlockIds.length
    ? await prisma.folio.findMany({
        where: { groupBlockId: { in: groupBlockIds }, isMaster: true, isClosed: false },
        select: { id: true, groupBlockId: true },
      })
    : []
  const masterFolioByBlock = new Map(masterFolios.map((f) => [f.groupBlockId!, f.id]))

  // Transport charges due for realization. Hotel-booked, priced, charge-coded legs not
  // yet posted, whose realization date — transport time → carrier time → check-in
  // (pickup) / check-out (dropoff) — falls on or before the audit date. Posted in the
  // same pass as Room & Tax so transport revenue books on its own date (and catches up
  // if a day was missed); chargedLineItemId prevents any double-charge.
  const dayMsUTC = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const transportCandidates = await prisma.reservationTransport.findMany({
    where: {
      reservation: { propertyId },
      chargeToGuest: true,
      chargedLineItemId: null,
      chargeAmount: { gt: 0 },
      chargeCodeId: { not: null },
    },
    include: {
      reservation: {
        select: {
          id: true,
          checkInDate: true,
          checkOutDate: true,
          folios: { where: { isClosed: false }, orderBy: { folioNumber: "asc" }, select: { id: true } },
        },
      },
    },
  })
  const dueTransport = transportCandidates.filter((leg) => {
    const t = leg.transportTime ?? leg.carrierTime ?? (leg.direction === "PICKUP" ? leg.reservation.checkInDate : leg.reservation.checkOutDate)
    return dayMsUTC(t) < dayMsUTC(nextDay)
  })
  const transportCodeIds = [...new Set(dueTransport.map((l) => l.chargeCodeId).filter((x): x is string => !!x))]
  const transportCodeMap = new Map(
    (transportCodeIds.length
      ? await prisma.chargeCode.findMany({ where: { id: { in: transportCodeIds }, propertyId: property.id }, include: taxInclude })
      : []
    ).map((c) => [c.id, c])
  )
  let transportChargesPosted = 0

  // Atomic idempotency claim — the real guard against a concurrent/retried run
  // double-posting. The `alreadyRun` fast-path read above is only a cheap
  // short-circuit; it can't prevent a race (two runs both read null before either
  // commits). @@unique([propertyId, auditDate]) makes the insert below the single
  // point where exactly one run wins: the first inserts an IN_PROGRESS row, a racing
  // run's insert hits the unique constraint and is rejected here, before any posting.
  // A prior FAILED attempt (including a timed-out one, since the tx catch flips the
  // claim to FAILED) is reclaimable so retries still work; the atomic
  // updateMany(status: "FAILED") ensures only one of two concurrent retries reclaims it.
  let auditLog: { id: string } | null
  try {
    auditLog = await prisma.propertyNightAuditLog.create({
      data: { propertyId, auditDate, executedBy, roomsOccupied: 0, roomRevenue: 0, taxPosted: 0, totalPostings: 0, status: "IN_PROGRESS" },
    })
  } catch (claimError) {
    if (claimError instanceof Prisma.PrismaClientKnownRequestError && claimError.code === "P2002") {
      const reclaimed = await prisma.propertyNightAuditLog.updateMany({
        where: { propertyId, auditDate, status: "FAILED" },
        data: { executedBy, executedAt: new Date(), roomsOccupied: 0, roomRevenue: 0, taxPosted: 0, totalPostings: 0, status: "IN_PROGRESS" },
      })
      if (reclaimed.count === 0) {
        const existing = await prisma.propertyNightAuditLog.findUnique({
          where: { propertyId_auditDate: { propertyId, auditDate } },
        })
        return NextResponse.json(
          { error: `Night audit is already ${existing?.status === "COMPLETED" ? "complete" : "in progress"} for ${auditDate.toISOString().slice(0, 10)}.`, log: existing },
          { status: 409 }
        )
      }
      auditLog = await prisma.propertyNightAuditLog.findUnique({
        where: { propertyId_auditDate: { propertyId, auditDate } },
      })
    } else {
      throw claimError
    }
  }
  if (!auditLog) {
    return NextResponse.json({ error: "Could not claim the night-audit run." }, { status: 500 })
  }

  const stayNightCtx: StayNightContext = {
    settings,
    pricesIncludeTaxes,
    fallbackRoomCode,
    baseRatePlan,
    impliedGreenTaxGenerate,
    routeTo,
  }

  // 2. Post every reservation's nightly charges and write the audit log in ONE
  // transaction — a failure anywhere rolls back every posting, so the ledger can
  // never be left half-audited. (Reads stay outside for speed; writes are cheap.)
  let log
  let hkShift: { occupiedToDirty: number; vacantShifted: number } = { occupiedToDirty: 0, vacantShifted: 0 }
  try {
    log = await prisma.$transaction(async (tx) => {
      for (const res of chargeableReservations) {
        if (res.folios.length === 0) continue

        // Skip tonight entirely if this night was already billed upfront by an Advance
        // Bill (posted then, dated the settlement day). Re-posting room/allocation/
        // green-tax here would double-charge. Transport is a separate pass keyed on
        // chargedLineItemId, so it's already double-post-safe.
        if (res.advanceBilledThrough && dayMsUTC(res.advanceBilledThrough) >= dayMsUTC(auditDate)) continue

        // Always posts to the reservation's own folio, regardless of settlement method —
        // City Ledger reservations accumulate charges on their own folio exactly like
        // any other stay; the transfer to a debtor account only happens at checkout
        // (see reservations/[id]/check-out/route.ts), not here. Debtors intentionally
        // never sees anything from an in-house reservation.
        // Default posting target: the block master folio for a bill-to-master group
        // pickup, else the reservation's own folio. routeTo can still redirect per rule.
        const groupMasterFolioId = res.groupBlockId && res.groupBillToMaster ? masterFolioByBlock.get(res.groupBlockId) : undefined
        const targetFolioId = groupMasterFolioId ?? res.folios[0].id

        // Room, extra occupancy and tonight's allocations — the same code a held night
        // is charged through at a late check-in (src/lib/night-audit/stay-night.ts).
        const night = await postStayNight(tx, res, { night: auditDate, postDate: today, folioId: targetFolioId }, stayNightCtx)
        if (!night) continue
        if (night.zeroRate) zeroRateConfirmationNos.push(res.confirmationNo)
        totalRoomRevenue += night.roomRevenue
        totalTaxPosted += night.taxPosted
        totalPostings += night.postings

        // (2b. Green Tax was posted above as a generate off the room charge — see
        // impliedGreenTaxGenerate. No hardcoded GTX branch remains.)
      }

      // 2b-bis. Post transport charges due for realization (see dueTransport above) —
      // hotel-booked pickup/dropoff, on its own date, alongside room & tax. Posts to the
      // reservation's open folio; chargedLineItemId is stamped so it can't double-post.
      for (const leg of dueTransport) {
        const folio = leg.reservation.folios[0]
        if (!folio) continue // no open folio to bill (e.g. already checked out) — skipped
        const code = leg.chargeCodeId ? transportCodeMap.get(leg.chargeCodeId) : null
        if (!code) continue
        const dirLabel = leg.direction === "PICKUP" ? "Pickup" : "Dropoff"
        const posted = await postCharge(tx, {
          folioId: folio.id,
          chargeCode: code,
          inputAmount: leg.chargeAmount!,
          settings,
          pricesIncludeTaxes,
          date: today,
          description: `Transport – ${dirLabel}${leg.transportType ? ` (${leg.transportType})` : ""}`,
          reference: leg.transportNo ?? leg.carrierCode ?? null,
        })
        await tx.reservationTransport.update({ where: { id: leg.id }, data: { chargedLineItemId: posted.parent.id } })
        totalTaxPosted += posted.taxTotal + posted.leviesTotal
        totalPostings += 1 + posted.generated.length
        transportChargesPosted += 1
      }

      // 2c. Mark tonight's never-arrived reservations NO_SHOW — same transaction,
      // so a rolled-back audit doesn't leave half-processed no-shows either.
      if (noShowCandidates.length > 0) {
        await tx.reservation.updateMany({
          where: { id: { in: noShowCandidates.map((r) => r.id) } },
          data: { status: "NO_SHOW", noShowAt: auditDate },
        })
      }
      // No-show charges: ALWAYS post to a folio (created if the reservation has none)
      // so the charge carries into billing. Each uses its own selected rule's charge
      // code, posted on the audit date.
      //
      // Posted through postCharge like everything else, so the fee's charge code taxes
      // and generates normally. The rule's amount is treated the same way every other
      // configured price in the app is — gross or net per the property's "Prices
      // Include Taxes" setting.
      for (const nf of noShowFees) {
        let folioId = nf.folioId
        if (!folioId) {
          const folio = await tx.folio.create({
            data: { reservationId: nf.reservationId, propertyId, folioNumber: 1 },
          })
          folioId = folio.id
        }
        const feeCode = noShowCodeMap.get(nf.chargeCodeId)
        if (!feeCode) continue
        await postCharge(tx, {
          folioId,
          chargeCode: feeCode,
          inputAmount: nf.fee,
          settings,
          pricesIncludeTaxes,
          date: auditDate,
          description: "No-show charge",
        })
      }

      // 3. Flip the pre-claimed IN_PROGRESS row to COMPLETED — inside the same
      // transaction, so a COMPLETED log exists if and only if every posting above
      // landed. (The row was claimed atomically before the transaction; updating it
      // here rather than inserting a second row keeps @@unique([propertyId, auditDate])
      // intact and preserves retry-after-failure semantics.)
      const createdLog = await tx.propertyNightAuditLog.update({
        where: { id: auditLog.id },
        data: {
          executedBy,
          executedAt: new Date(),
          roomsOccupied: activeReservations.length,
          roomRevenue: totalRoomRevenue,
          taxPosted: totalTaxPosted,
          totalPostings,
          status: "COMPLETED"
        }
      })

      // 3b. Optional housekeeping auto-shift (per-property setting): occupied rooms
      // go Dirty for daily service, vacant sellable rooms step down / reset per the
      // configured mode. A no-op when the property has it OFF (the default).
      hkShift = await applyEodHousekeepingShift(tx, {
        propertyId,
        auditDate,
        mode: property.eodHousekeepingMode,
        targetStatus: property.eodHousekeepingTargetStatus,
      })

      // 4. Roll THIS property's business date forward one day — the manual EOD roll.
      // Per-property, so it never affects a sibling property. EnterpriseSettings.
      // systemDate (the server date) is deliberately left untouched now.
      await tx.property.update({
        where: { id: propertyId },
        data: { businessDate: nextDay },
      })

      return createdLog
    }, { timeout: 30_000 })
  } catch (postingError) {
    // The transaction rolled back — no charges were posted. Flip the pre-claimed row
    // to FAILED (outside the transaction, or it would roll back too) so the status
    // page shows the attempt instead of it vanishing — and, crucially, so a retry can
    // reclaim this same row rather than being blocked by the unique key.
    console.error("Night audit failed and was rolled back:", postingError)
    await prisma.propertyNightAuditLog.update({
      where: { id: auditLog.id },
      data: {
        executedBy,
        executedAt: new Date(),
        roomsOccupied: activeReservations.length,
        roomRevenue: 0,
        taxPosted: 0,
        totalPostings: 0,
        status: "FAILED"
      }
    }).catch(() => { /* logging the failure must never mask it */ })
    return NextResponse.json(
      { error: "Night audit failed — all postings were rolled back. Nothing was charged." },
      { status: 500 }
    )
  }

  await logActivity({
    ctx,
    module: "NIGHT_AUDIT",
    action: "RUN",
    entityType: "PropertyNightAuditLog",
    entityId: log.id,
    description: `Night audit for ${auditDate.toISOString().slice(0, 10)}: ${totalPostings} posting${totalPostings === 1 ? "" : "s"}, $${totalRoomRevenue.toFixed(2)} room revenue, ${noShowCandidates.length} no-show${noShowCandidates.length === 1 ? "" : "s"}`,
  })

  return NextResponse.json({
    success: true,
    log,
    noShowsProcessed: noShowCandidates.length,
    ...((hkShift.occupiedToDirty > 0 || hkShift.vacantShifted > 0) && { housekeepingShift: hkShift }),
    ...(transportChargesPosted > 0 && { transportChargesPosted }),
    ...(noShowCandidates.length > 0 && {
      noShowConfirmationNos: noShowCandidates.map((r) => r.confirmationNo),
    }),
    ...(noShowFees.length > 0 && {
      // Every no-show fee is now posted to a folio; list them all as charged.
      noShowFeesCharged: noShowFees.map((f) => ({ confirmationNo: f.confirmationNo, fee: f.fee })),
    }),
    ...(noShowFees.some((f) => !f.hadFolio) && {
      // Posted to a freshly-created folio with no deposit behind it → unpaid, collect it.
      noShowFeesOwed: noShowFees.filter((f) => !f.hadFolio).map((f) => ({ confirmationNo: f.confirmationNo, fee: f.fee })),
      noShowFeesOwedWarning: `${noShowFees.filter((f) => !f.hadFolio).length} no-show charge${noShowFees.filter((f) => !f.hadFolio).length > 1 ? "s were" : " was"} posted to a new folio with no deposit on file — collect payment from front office.`,
    }),
    ...(zeroRateConfirmationNos.length > 0 && {
      zeroRateWarning: `${zeroRateConfirmationNos.length} reservation${zeroRateConfirmationNos.length > 1 ? "s" : ""} posted a $0 room charge because no rate is configured for tonight — check the Price Calendar (including the Base plan's coverage).`,
      zeroRateConfirmationNos,
    }),
    ...(heldArrivals.length > 0 && {
      heldArrivalsWarning:
        settings.noShowTiming === "MANUAL"
          ? `${heldArrivals.length} arrival${heldArrivals.length > 1 ? "s have" : " has"} not checked in — no-shows are marked by the front desk at this property.`
          : `${heldArrivals.length} arrival${heldArrivals.length > 1 ? "s were" : " was"} held for a late check-in — marked a no-show at the next audit if still not arrived.`,
      heldArrivalConfirmationNos: heldArrivals.map((r) => r.confirmationNo),
    }),
    ...(overstays.length > 0 && {
      overstayWarning: `${overstays.length} in-house reservation${overstays.length > 1 ? "s are" : " is"} past the check-out date and did not accrue a room charge — check them out or extend the stay.`,
      overstayConfirmationNos: overstays.map((r) => r.confirmationNo),
    }),
  })
}
