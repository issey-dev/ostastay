import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { resolveChargeTax } from "@/lib/tax-calc"
import { applyRateAdjustment } from "@/lib/derived-rate"
import { allocationAmountForNight } from "@/lib/allocations"
import { resolveBusinessDate, nextBusinessDate } from "@/lib/business-date"
import { getFeeRuleById, computeReservationFee } from "@/lib/fee-rules"
import { logActivity } from "@/lib/activity-log"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "NIGHT_AUDIT", "create")

    const body = await request.json()
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

    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: property.enterpriseId }
    })

    // Accommodation charge code the nightly room charge posts against, resolved per
    // reservation in the loop as: the reservation's rate plan's own chargeCode -> the
    // enterprise default accommodation code (EnterpriseSettings) -> the legacy "ROOM"
    // code. At least one enterprise-level fallback must exist so every reservation can
    // resolve; a per-plan code is optional on top.
    const taxInclude = { taxProfile: { include: { rates: true } } } as const
    const defaultAccommodationCode = settings?.defaultAccommodationChargeCodeId
      ? await prisma.chargeCode.findFirst({
          where: { id: settings.defaultAccommodationChargeCodeId, enterpriseId: property.enterpriseId },
          include: taxInclude,
        })
      : null
    const legacyRoomCode = await prisma.chargeCode.findFirst({
      where: { enterpriseId: property.enterpriseId, code: "ROOM" },
      include: taxInclude,
    })
    const fallbackRoomCode = defaultAccommodationCode ?? legacyRoomCode

    if (!fallbackRoomCode) {
      return NextResponse.json(
        { error: "No accommodation charge code configured. Set a default in Controls > Finance (or add a ROOM charge code)." },
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
    // Infants (Reservation.infants) are exempt and not counted. Only require the GTX
    // charge code to exist when Green Tax is actually enabled for this enterprise.
    const greenTaxEnabled = settings?.greenTaxEnabled ?? false
    let gtxCode = null
    if (greenTaxEnabled) {
      gtxCode = await prisma.chargeCode.findFirst({
        where: { enterpriseId: property.enterpriseId, code: "GTX" }
      })
      if (!gtxCode) {
        return NextResponse.json({ error: "Missing GTX charge code in system settings." }, { status: 400 })
      }
    }

    // 1. Fetch all currently checked-in reservations
    const activeReservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: "IN_HOUSE"
      },
      include: {
        folios: {
          where: { isClosed: false }
        },
        assignments: {
          orderBy: { startDate: 'desc' },
          include: {
            roomType: true,
            // "Charge as" room type (kept-rate room move) — pricing resolves off this when set.
            chargeRoomType: true,
            ratePlan: { include: { chargeCode: { include: taxInclude } } },
          }
        },
        // The materialized allocation set (see ReservationAllocation) — each with its
        // allocation's rates and charge code (incl. tax profile) for posting.
        allocations: {
          include: {
            allocation: {
              include: {
                rates: true,
                chargeCode: { include: { taxProfile: { include: { rates: true } } } },
              },
            },
          },
        },
      }
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
    // transaction below. Each no-show's fee comes from ITS OWN selected NO_SHOW rule
    // (Reservation.noShowFeeRuleId) — no selection means no fee. When a fee applies it is
    // ALWAYS posted to a folio (created if the reservation has none) so it carries into
    // billing (owner rule 2026-07-24), on the audit date.
    const noShowCandidates = await prisma.reservation.findMany({
      where: { propertyId, status: "RESERVED", checkInDate: { lt: nextDay } },
      include: { assignments: true, folios: { include: { payments: true } } },
    })

    type NoShowFee = { reservationId: string; confirmationNo: string; fee: number; chargeCodeId: string; folioId: string | null; hadFolio: boolean }
    const noShowFees: NoShowFee[] = []
    for (const r of noShowCandidates) {
      const rule = await getFeeRuleById(r.noShowFeeRuleId, "NO_SHOW")
      if (!rule || !rule.chargeCodeId) continue
      const fee = await computeReservationFee(rule, r)
      if (fee > 0.005) {
        const openFolio = r.folios.find((f) => !f.isClosed) ?? r.folios[0] ?? null
        noShowFees.push({ reservationId: r.id, confirmationNo: r.confirmationNo, fee, chargeCodeId: rule.chargeCodeId, folioId: openFolio?.id ?? null, hadFolio: !!openFolio })
      }
    }

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
        ? await prisma.chargeCode.findMany({ where: { id: { in: transportCodeIds }, enterpriseId: property.enterpriseId }, include: taxInclude })
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

    // 2. Post every reservation's nightly charges and write the audit log in ONE
    // transaction — a failure anywhere rolls back every posting, so the ledger can
    // never be left half-audited. (Reads stay outside for speed; writes are cheap.)
    let log
    try {
      log = await prisma.$transaction(async (tx) => {
        for (const res of chargeableReservations) {
          if (res.folios.length === 0) continue

          // Skip tonight entirely if this night was already billed upfront by an Advance
          // Bill (posted then, dated the settlement day). Re-posting room/allocation/
          // green-tax here would double-charge. Transport is a separate pass keyed on
          // chargedLineItemId, so it's already double-post-safe.
          if (res.advanceBilledThrough && dayMsUTC(res.advanceBilledThrough) >= dayMsUTC(auditDate)) continue

          const activeAssignment = res.assignments[0]
          if (!activeAssignment) continue

          // Always posts to the reservation's own folio, regardless of settlement method —
          // City Ledger reservations accumulate charges on their own folio exactly like
          // any other stay; the transfer to a debtor account only happens at checkout
          // (see reservations/[id]/check-out/route.ts), not here. Debtors intentionally
          // never sees anything from an in-house reservation.
          // Default posting target: the block master folio for a bill-to-master group
          // pickup, else the reservation's own folio. routeTo can still redirect per rule.
          const groupMasterFolioId = res.groupBlockId && res.groupBillToMaster ? masterFolioByBlock.get(res.groupBlockId) : undefined
          const targetFolioId = groupMasterFolioId ?? res.folios[0].id

          // Derived Rate Plans read PriceCalendar under their PARENT's id — they have no
          // rows of their own (see src/lib/derived-rate.ts) — then the adjustment is
          // applied below to whatever price results, including the Base Rate plan
          // fallback, so a derived plan is always "parent price + adjustment" no matter
          // where the parent's price actually came from.
          const activeRatePlan = activeAssignment.ratePlan
          const isDerivedRatePlan = !!activeRatePlan.parentRatePlanId
          const calendarRatePlanId = isDerivedRatePlan ? activeRatePlan.parentRatePlanId! : activeAssignment.ratePlanId
          // Price against the "charge as" room type when set (kept-rate move), else the
          // physical room type. Governs the PriceCalendar lookup AND base occupancy below.
          const chargeRoomTypeId = activeAssignment.chargeRoomTypeId ?? activeAssignment.roomTypeId
          const chargeRoomType = activeAssignment.chargeRoomType ?? activeAssignment.roomType

          // Room charge posts against the rate plan's own accommodation code when set,
          // else the enterprise fallback resolved above.
          const roomCode = activeRatePlan.chargeCode ?? fallbackRoomCode

          const todayRange = { gte: auditDate, lt: nextDay }

          // Fetched unconditionally (not just when overrideRate is unset) since extra-
          // occupancy surcharges are a separate additive charge tied to today's calendar
          // entry — a manual base-rate override shouldn't silently suppress them.
          const calendarEntry = await tx.priceCalendar.findFirst({
            where: { ratePlanId: calendarRatePlanId, roomTypeId: chargeRoomTypeId, date: todayRange }
          })

          let inputAmount = activeAssignment.overrideRate
          if (inputAmount == null) {
            let baseRoomPrice = calendarEntry?.price
            // No entry under the assigned (or derived-from) plan — fall back to the
            // property's locked Base Rate plan's own Price Calendar entry for tonight
            // (skip the extra lookup if that's already what we just checked above).
            if (baseRoomPrice == null && baseRatePlan && calendarRatePlanId !== baseRatePlan.id) {
              const baseCalendarEntry = await tx.priceCalendar.findFirst({
                where: { ratePlanId: baseRatePlan.id, roomTypeId: chargeRoomTypeId, date: todayRange }
              })
              baseRoomPrice = baseCalendarEntry?.price
            }
            if (baseRoomPrice == null) {
              zeroRateConfirmationNos.push(res.confirmationNo)
            }
            baseRoomPrice = baseRoomPrice ?? 0
            if (isDerivedRatePlan) {
              baseRoomPrice = applyRateAdjustment(baseRoomPrice, activeRatePlan.derivedAdjustmentType!, activeRatePlan.derivedAdjustmentValue!)
            }
            inputAmount = baseRoomPrice
          }

          // Resolve tonight's allocation postings (see src/lib/allocations.ts — the same
          // rhythm/date-range/pax math the reservation form previews with). Attached rows
          // post regardless of the allocation's current isActive — deactivation only stops
          // NEW attachments; a guest who booked breakfast still gets billed for it.
          const allocationsTonight: Array<{
            reservationAllocation: (typeof res.allocations)[number]
            grossInput: number
          }> = []
          for (const ra of res.allocations) {
            const amount = allocationAmountForNight({
              allocation: ra.allocation,
              adults: res.adults,
              children: res.children,
              checkInDate: res.checkInDate,
              checkOutDate: res.checkOutDate,
              auditDate: today,
              overrideAdultPrice: ra.overrideAdultPrice,
              overrideChildPrice: ra.overrideChildPrice,
            })
            if (amount != null && amount > 0) {
              allocationsTonight.push({ reservationAllocation: ra, grossInput: amount })
            }
          }

          // INCLUDE_IN_RATE allocations are carved OUT of the room line before it is
          // tax-resolved — folio total unchanged, revenue attribution moves to the
          // allocation's charge code. Clamped at zero: allocations can never push the
          // room line negative (the allocation lines still post in full).
          const includeInRateGross = allocationsTonight
            .filter((a) => a.reservationAllocation.allocation.mode === "INCLUDE_IN_RATE")
            .reduce((sum, a) => sum + a.grossInput, 0)
          const roomInputAfterCarveOut = Math.max(0, inputAmount - includeInRateGross)

          const { baseAmount, taxAmount, serviceChargeAmount } = resolveChargeTax({
            chargeCode: roomCode,
            inputAmount: roomInputAfterCarveOut,
            settings,
            pricesIncludeTaxes
          })

          await tx.folioLineItem.create({
            data: {
              folioId: routeTo(res.id, roomCode.id, targetFolioId),
              chargeCodeId: roomCode.id,
              roomAssignmentId: activeAssignment.id,
              amount: baseAmount,
              taxAmount,
              serviceChargeAmount,
              description: "Nightly Room Charge",
              date: today
            }
          })

          totalRoomRevenue += baseAmount
          totalTaxPosted += taxAmount + serviceChargeAmount
          totalPostings += 1

          // 2a. Post an extra-occupancy surcharge — adults beyond RoomType.baseOccupancy
          // at today's calendar extraAdultPrice, plus every child at extraChildPrice (no
          // "included children" baseline, same convention as Green Tax). Both rates are
          // optional per PriceCalendar day (no RoomType-level fallback), so this is a
          // no-op unless the property has actually configured them for today.
          const extraAdults = Math.max(0, res.adults - chargeRoomType.baseOccupancy)
          const extraOccupancyInput =
            extraAdults * (calendarEntry?.extraAdultPrice ?? 0) + res.children * (calendarEntry?.extraChildPrice ?? 0)

          if (extraOccupancyInput > 0) {
            const extraOccupancy = resolveChargeTax({
              chargeCode: roomCode,
              inputAmount: extraOccupancyInput,
              settings,
              pricesIncludeTaxes
            })

            const parts = []
            if (extraAdults > 0) parts.push(`${extraAdults} extra adult${extraAdults > 1 ? "s" : ""}`)
            if (res.children > 0) parts.push(`${res.children} child${res.children > 1 ? "ren" : ""}`)

            await tx.folioLineItem.create({
              data: {
                folioId: routeTo(res.id, roomCode.id, targetFolioId),
                chargeCodeId: roomCode.id,
                roomAssignmentId: activeAssignment.id,
                amount: extraOccupancy.baseAmount,
                taxAmount: extraOccupancy.taxAmount,
                serviceChargeAmount: extraOccupancy.serviceChargeAmount,
                description: `Extra Occupancy Charge (${parts.join(", ")})`,
                date: today
              }
            })

            totalRoomRevenue += extraOccupancy.baseAmount
            totalTaxPosted += extraOccupancy.taxAmount + extraOccupancy.serviceChargeAmount
            totalPostings += 1
          }

          // 2a-bis. Post tonight's allocations (Breakfast, Transfers, Spa... — see
          // .agents/docs/ALLOCATIONS_PLAN.md). Each posts against its own charge code
          // through the same tax engine; INCLUDE_IN_RATE ones were already carved out of
          // the room line above, ADD_TO_RATE/SELL_SEPARATE ones are purely additive.
          // (A meal plan's per-person pricing arrives here via its linked allocations —
          // materialized on the reservation at booking time, not re-resolved live.)
          for (const { reservationAllocation: ra, grossInput } of allocationsTonight) {
            const alloc = ra.allocation
            const allocTax = resolveChargeTax({
              chargeCode: alloc.chargeCode,
              inputAmount: grossInput,
              settings,
              pricesIncludeTaxes
            })

            const paxParts = []
            if (res.adults > 0) paxParts.push(`${res.adults} adult${res.adults > 1 ? "s" : ""}`)
            if (res.children > 0) paxParts.push(`${res.children} child${res.children > 1 ? "ren" : ""}`)

            await tx.folioLineItem.create({
              data: {
                folioId: routeTo(res.id, alloc.chargeCodeId, targetFolioId),
                chargeCodeId: alloc.chargeCodeId,
                amount: allocTax.baseAmount,
                taxAmount: allocTax.taxAmount,
                serviceChargeAmount: allocTax.serviceChargeAmount,
                description: `${alloc.name} (${paxParts.join(", ")})`,
                date: today
              }
            })

            totalTaxPosted += allocTax.taxAmount + allocTax.serviceChargeAmount
            totalPostings += 1
          }

          // 2b. Post nightly Green Tax — flat per adult/child, infants exempt.
          if (greenTaxEnabled && gtxCode) {
            const greenTaxAmount = Math.round(
              (res.adults * (settings!.greenTaxAdultAmount) + res.children * (settings!.greenTaxChildAmount)) * 100
            ) / 100

            if (greenTaxAmount > 0) {
              await tx.folioLineItem.create({
                data: {
                  folioId: routeTo(res.id, gtxCode.id, targetFolioId),
                  chargeCodeId: gtxCode.id,
                  amount: greenTaxAmount,
                  taxAmount: 0,
                  serviceChargeAmount: 0,
                  description: "Green Tax",
                  date: today
                }
              })

              totalTaxPosted += greenTaxAmount
              totalPostings += 1
            }
          }
        }

        // 2b-bis. Post transport charges due for realization (see dueTransport above) —
        // hotel-booked pickup/dropoff, on its own date, alongside room & tax. Posts to the
        // reservation's open folio; chargedLineItemId is stamped so it can't double-post.
        for (const leg of dueTransport) {
          const folio = leg.reservation.folios[0]
          if (!folio) continue // no open folio to bill (e.g. already checked out) — skipped
          const code = leg.chargeCodeId ? transportCodeMap.get(leg.chargeCodeId) : null
          if (!code) continue
          const tx2 = resolveChargeTax({ chargeCode: code, inputAmount: leg.chargeAmount!, settings, pricesIncludeTaxes })
          const dirLabel = leg.direction === "PICKUP" ? "Pickup" : "Dropoff"
          const li = await tx.folioLineItem.create({
            data: {
              folioId: folio.id,
              chargeCodeId: code.id,
              amount: tx2.baseAmount,
              taxAmount: tx2.taxAmount,
              serviceChargeAmount: tx2.serviceChargeAmount,
              description: `Transport – ${dirLabel}${leg.transportType ? ` (${leg.transportType})` : ""}`,
              reference: leg.transportNo ?? leg.carrierCode ?? null,
              date: today,
            },
          })
          await tx.reservationTransport.update({ where: { id: leg.id }, data: { chargedLineItemId: li.id } })
          totalTaxPosted += tx2.taxAmount + tx2.serviceChargeAmount
          totalPostings += 1
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
        for (const nf of noShowFees) {
          let folioId = nf.folioId
          if (!folioId) {
            const folio = await tx.folio.create({
              data: { reservationId: nf.reservationId, propertyId, folioNumber: 1 },
            })
            folioId = folio.id
          }
          await tx.folioLineItem.create({
            data: {
              folioId,
              chargeCodeId: nf.chargeCodeId,
              date: auditDate,
              description: "No-show charge",
              amount: nf.fee,
              taxAmount: 0,
              serviceChargeAmount: 0,
            },
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
      ...(overstays.length > 0 && {
        overstayWarning: `${overstays.length} in-house reservation${overstays.length > 1 ? "s are" : " is"} past the check-out date and did not accrue a room charge — check them out or extend the stay.`,
        overstayConfirmationNos: overstays.map((r) => r.confirmationNo),
      }),
    })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
