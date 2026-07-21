import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { resolveChargeTax } from "@/lib/tax-calc"
import { applyRateAdjustment } from "@/lib/derived-rate"
import { allocationAmountForNight } from "@/lib/allocations"
import { resolveBusinessDate, nextBusinessDate } from "@/lib/business-date"
import { logActivity } from "@/lib/activity-log"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "NIGHT_AUDIT", "create")

    const { propertyId } = await request.json()

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
    // transaction below — standard end-of-day processing. NO_SHOW releases their
    // rooms back to sellable inventory (see src/lib/availability.ts); any deposit
    // stays on their still-open folio for front office to resolve (refund or forfeit
    // via a fee posting) — nothing financial happens automatically here.
    const noShowCandidates = await prisma.reservation.findMany({
      where: { propertyId, status: "RESERVED", checkInDate: { lt: nextDay } },
      select: { id: true, confirmationNo: true },
    })

    let totalRoomRevenue = 0
    let totalTaxPosted = 0
    let totalPostings = 0

    // Reservations whose nightly rate resolved to $0 with no override — almost always
    // a Price Calendar coverage gap (the Base plan only covers dates it was actually
    // bulk-priced for), i.e. silently lost revenue. Posted anyway (matching existing
    // behavior) but called out in the response.
    const zeroRateConfirmationNos: string[] = []

    // 2. Post every reservation's nightly charges and write the audit log in ONE
    // transaction — a failure anywhere rolls back every posting, so the ledger can
    // never be left half-audited. (Reads stay outside for speed; writes are cheap.)
    let log
    try {
      log = await prisma.$transaction(async (tx) => {
        for (const res of chargeableReservations) {
          if (res.folios.length === 0) continue

          const activeAssignment = res.assignments[0]
          if (!activeAssignment) continue

          // Always posts to the reservation's own folio, regardless of settlement method —
          // City Ledger reservations accumulate charges on their own folio exactly like
          // any other stay; the transfer to a debtor account only happens at checkout
          // (see reservations/[id]/check-out/route.ts), not here. Debtors intentionally
          // never sees anything from an in-house reservation.
          const targetFolioId = res.folios[0].id

          // Derived Rate Plans read PriceCalendar under their PARENT's id — they have no
          // rows of their own (see src/lib/derived-rate.ts) — then the adjustment is
          // applied below to whatever price results, including the Base Rate plan
          // fallback, so a derived plan is always "parent price + adjustment" no matter
          // where the parent's price actually came from.
          const activeRatePlan = activeAssignment.ratePlan
          const isDerivedRatePlan = !!activeRatePlan.parentRatePlanId
          const calendarRatePlanId = isDerivedRatePlan ? activeRatePlan.parentRatePlanId! : activeAssignment.ratePlanId

          // Room charge posts against the rate plan's own accommodation code when set,
          // else the enterprise fallback resolved above.
          const roomCode = activeRatePlan.chargeCode ?? fallbackRoomCode

          const todayRange = { gte: auditDate, lt: nextDay }

          // Fetched unconditionally (not just when overrideRate is unset) since extra-
          // occupancy surcharges are a separate additive charge tied to today's calendar
          // entry — a manual base-rate override shouldn't silently suppress them.
          const calendarEntry = await tx.priceCalendar.findFirst({
            where: { ratePlanId: calendarRatePlanId, roomTypeId: activeAssignment.roomTypeId, date: todayRange }
          })

          let inputAmount = activeAssignment.overrideRate
          if (inputAmount == null) {
            let baseRoomPrice = calendarEntry?.price
            // No entry under the assigned (or derived-from) plan — fall back to the
            // property's locked Base Rate plan's own Price Calendar entry for tonight
            // (skip the extra lookup if that's already what we just checked above).
            if (baseRoomPrice == null && baseRatePlan && calendarRatePlanId !== baseRatePlan.id) {
              const baseCalendarEntry = await tx.priceCalendar.findFirst({
                where: { ratePlanId: baseRatePlan.id, roomTypeId: activeAssignment.roomTypeId, date: todayRange }
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
              folioId: targetFolioId,
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
          const extraAdults = Math.max(0, res.adults - activeAssignment.roomType.baseOccupancy)
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
                folioId: targetFolioId,
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
                folioId: targetFolioId,
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
                  folioId: targetFolioId,
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

        // 2c. Mark tonight's never-arrived reservations NO_SHOW — same transaction,
        // so a rolled-back audit doesn't leave half-processed no-shows either.
        if (noShowCandidates.length > 0) {
          await tx.reservation.updateMany({
            where: { id: { in: noShowCandidates.map((r) => r.id) } },
            data: { status: "NO_SHOW" },
          })
        }

        // 3. Log the audit run — inside the same transaction, so a COMPLETED log row
        // exists if and only if every posting above landed.
        const createdLog = await tx.propertyNightAuditLog.create({
          data: {
            propertyId,
            auditDate,
            executedBy,
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
      // The transaction rolled back — no charges were posted. Record the failed run
      // (outside the transaction, or it would roll back too) so the status page shows
      // the attempt instead of it vanishing without a trace.
      console.error("Night audit failed and was rolled back:", postingError)
      await prisma.propertyNightAuditLog.create({
        data: {
          propertyId,
          auditDate,
          executedBy,
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
      ...(noShowCandidates.length > 0 && {
        noShowConfirmationNos: noShowCandidates.map((r) => r.confirmationNo),
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
