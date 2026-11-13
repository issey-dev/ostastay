import { NextResponse } from "next/server"
import { LIVE_PICKUP_WHERE } from "@/lib/groups/block-profiles"
import { processDueCheckpoints } from "@/lib/groups/release"
import { figuresJson } from "@/lib/figures"
import { ensurePostingMaster, checkInPostingMaster, syncPostingMasterDates, cancelPostingMaster } from "@/lib/groups/posting-master"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { GROUP_STATUSES, GROUP_RELEASING_STATUSES, GROUP_STATUS_LABEL, canTransitionGroupStatus, type GroupStatus } from "@/lib/group-status"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "view")
    const { id } = await params
    await processDueCheckpoints({ groupBlockId: id })
    const group = await prisma.groupBlock.findUnique({
      where: { id },
      include: {
        reservations: {
          include: {
            primaryGuest: true,
            assignments: {
              include: {
                roomType: true,
                room: true
              }
            }
          }
        },
        masterFolios: {
          include: {
            lineItems: {
              include: { chargeCode: true }
            },
            payments: {
              include: { paymentMethod: true }
            }
          }
        },
        roomHolds: {
          include: { roomType: { select: { id: true, name: true, code: true } } },
        },
        payeeProfile: { select: { upid: true, firstName: true, lastName: true, companyName: true } },
        sourceProfile: { select: { upid: true, firstName: true, companyName: true, markerIcon: true, markerColor: true } },
        travelAgent: { select: { upid: true, firstName: true, lastName: true, companyName: true, profileType: true, isCreditAccount: true } },
        checkpoints: { orderBy: { date: "asc" } },
      }
    })

    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })
    await assertPropertyAccess(ctx, group.propertyId)

    return figuresJson(ctx, group)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(GROUP_STATUSES).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  cutoffDate: z.string().nullable().optional(),
  totalRoomsHeld: z.number().int().min(0).optional(),
  // Per-room-type holds — when provided, they replace the block's holds entirely and
  // totalRoomsHeld becomes their sum.
  roomHolds: z.array(z.object({ roomTypeId: z.string().min(1), quantity: z.number().int().min(0) })).optional(),
  // City-Ledger account for the master bill (null = clear / bill direct).
  payeeProfileId: z.string().nullable().optional(),
  // Blocks for Sources (Agent Portal plan A-12, Phase 4).
  sourceProfileId: z.string().nullable().optional(),
  // The block's Travel Agent or Company, carried by its reservations (owner, 2026-11-13).
  travelAgentId: z.string().nullable().optional(),
  releaseDays: z.number().int().min(0).max(365).nullable().optional(),
  elasticRooms: z.number().int().min(0).max(500).optional(),
  elasticNightsBefore: z.number().int().min(0).max(60).optional(),
  elasticNightsAfter: z.number().int().min(0).max(60).optional(),
  checkpoints: z.array(z.object({ date: z.string().min(1), minPercent: z.number().int().min(1).max(100) })).max(12).optional(),
})

// A block was previously frozen at creation — status, cutoff, and rooms-held could
// never change, even though pickup logic guards on all three. Guards here: rooms
// held can't shrink below what's already picked up, and a block with active
// pickups can't be cancelled out from under them.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "update")
    const { id } = await params

    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid group update payload", details: parsed.error.flatten() }, { status: 400 })
    }
    const data = parsed.data

    const group = await prisma.groupBlock.findUnique({ where: { id } })
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })
    await assertPropertyAccess(ctx, group.propertyId)

    // Enforce the status state machine (see src/lib/group-status.ts).
    if (data.status && data.status !== group.status && !canTransitionGroupStatus(group.status, data.status)) {
      return NextResponse.json(
        { error: `Cannot change status from ${GROUP_STATUS_LABEL[group.status as GroupStatus] ?? group.status} to ${GROUP_STATUS_LABEL[data.status]}.` },
        { status: 400 }
      )
    }

    const activePickups = await prisma.reservation.count({
      where: { groupBlockId: id, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    })

    // Releasing a block (Lost / Cancelled) can't strand live pickups.
    if (data.status && GROUP_RELEASING_STATUSES.includes(data.status) && activePickups > 0) {
      const verb = data.status === "LOST" ? "mark lost" : "cancel"
      return NextResponse.json(
        { error: `Cannot ${verb} a block with ${activePickups} active pickup${activePickups > 1 ? "s" : ""} — cancel those reservations first.` },
        { status: 400 }
      )
    }
    // Per-type holds (when provided) are the source of truth; totalRoomsHeld is their sum.
    const cleanedHolds = data.roomHolds
      ? data.roomHolds.map((h) => ({ roomTypeId: h.roomTypeId, quantity: h.quantity })).filter((h) => h.quantity > 0)
      : null
    const effectiveHeld = cleanedHolds ? cleanedHolds.reduce((s, h) => s + h.quantity, 0) : data.totalRoomsHeld

    if (effectiveHeld != null && effectiveHeld < activePickups) {
      return NextResponse.json(
        { error: `Rooms held cannot go below the ${activePickups} already picked up.` },
        { status: 400 }
      )
    }

    const startDate = data.startDate ? new Date(data.startDate) : group.startDate
    const endDate = data.endDate ? new Date(data.endDate) : group.endDate
    if (endDate <= startDate) {
      return NextResponse.json({ error: "End date must be after start date" }, { status: 400 })
    }

    // A slot request is decided on the Requests tab (availability checked there), never here.
    if (group.status === "REQUESTED" && data.status && data.status !== "REQUESTED") {
      return NextResponse.json({ error: "Approve or decline the request from the Requests tab." }, { status: 400 })
    }
    if (data.sourceProfileId) {
      const src = await prisma.profile.findUnique({ where: { upid: data.sourceProfileId } })
      if (!src || src.enterpriseId !== ctx.enterpriseId || src.profileType !== "SOURCE") {
        return NextResponse.json({ error: "Source profile not found" }, { status: 400 })
      }
    }
    if (data.travelAgentId) {
      const ta = await prisma.profile.findUnique({ where: { upid: data.travelAgentId } })
      if (!ta || ta.enterpriseId !== ctx.enterpriseId || !["TRAVEL_AGENT", "COMPANY"].includes(ta.profileType)) {
        return NextResponse.json({ error: "Travel agent or company profile not found" }, { status: 400 })
      }
    }

    // City-Ledger account: validate a credit account of this enterprise when set.
    if (data.payeeProfileId) {
      const payee = await prisma.profile.findUnique({ where: { upid: data.payeeProfileId } })
      if (!payee || payee.enterpriseId !== ctx.enterpriseId || !payee.isCreditAccount) {
        return NextResponse.json({ error: "Selected account is not a valid credit account for this enterprise." }, { status: 400 })
      }
    }

    // Cancelling / losing the block takes its Posting Master with it — unless that already
    // holds charges or has arrived, which has to be dealt with first.
    if (data.status && GROUP_RELEASING_STATUSES.includes(data.status) && data.status !== group.status) {
      const blocker = await cancelPostingMaster(id)
      if (blocker) return NextResponse.json({ error: blocker }, { status: 400 })
    }

    const updated = await prisma.groupBlock.update({
      where: { id },
      data: {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.status != null ? { status: data.status } : {}),
        ...(data.startDate != null ? { startDate } : {}),
        ...(data.endDate != null ? { endDate } : {}),
        ...(data.cutoffDate !== undefined
          ? { cutoffDate: data.cutoffDate ? new Date(data.cutoffDate) : null }
          : {}),
        ...(effectiveHeld != null ? { totalRoomsHeld: effectiveHeld } : {}),
        // Replace the block's holds wholesale when a new set is supplied.
        ...(cleanedHolds ? { roomHolds: { deleteMany: {}, create: cleanedHolds } } : {}),
        ...(data.payeeProfileId !== undefined ? { payeeProfileId: data.payeeProfileId || null } : {}),
        ...(data.sourceProfileId !== undefined ? { sourceProfileId: data.sourceProfileId || null } : {}),
        ...(data.travelAgentId !== undefined ? { travelAgentId: data.travelAgentId || null } : {}),
        ...(data.releaseDays !== undefined ? { releaseDays: data.releaseDays } : {}),
        ...(data.elasticRooms !== undefined ? { elasticRooms: data.elasticRooms } : {}),
        ...(data.elasticNightsBefore !== undefined ? { elasticNightsBefore: data.elasticNightsBefore } : {}),
        ...(data.elasticNightsAfter !== undefined ? { elasticNightsAfter: data.elasticNightsAfter } : {}),
        // Checkpoints: replace the unprocessed ones; processed ones are history and stay.
        ...(data.checkpoints
          ? {
              checkpoints: {
                deleteMany: { processedAt: null },
                create: data.checkpoints.map((c) => ({ date: new Date(c.date), minPercent: c.minPercent })),
              },
            }
          : {}),
      },
    })
    // A pickup inherits the block's Source: keep live pickups in step when it changes.
    if (data.sourceProfileId !== undefined && data.sourceProfileId !== group.sourceProfileId) {
      await prisma.reservation.updateMany({ where: LIVE_PICKUP_WHERE(id), data: { sourceProfileId: data.sourceProfileId || null } })
    }
    // Same for the Travel Agent / Company. Clearing it on the block leaves the pickups' own.
    if (data.travelAgentId && data.travelAgentId !== group.travelAgentId) {
      await prisma.reservation.updateMany({ where: LIVE_PICKUP_WHERE(id), data: { travelAgentId: data.travelAgentId } })
    }

    // Going Definite creates the Posting Master reservation (same as the master folio by hand).
    if (data.status === "DEFINITE" && group.status !== "DEFINITE") await ensurePostingMaster(id)
    // New dates carry over to the Posting Master's stay.
    if (data.startDate != null || data.endDate != null) await syncPostingMasterDates(id)

    // Keep an OPEN, not-yet-finalized master folio in sync with the block's account so
    // the settlement target reflects the current linkage (no effect once it's closed).
    if (data.payeeProfileId !== undefined) {
      const openMaster = await prisma.folio.findFirst({
        where: { groupBlockId: id, isMaster: true, isClosed: false, isDebtorAccount: false },
        select: { id: true },
      })
      if (openMaster) {
        await prisma.folio.update({
          where: { id: openMaster.id },
          data: data.payeeProfileId
            ? { settlementMethod: "CITY_LEDGER", payeeProfileId: data.payeeProfileId }
            : { settlementMethod: "DIRECT", payeeProfileId: null },
        })
      }
    }

    await logActivity({
      ctx,
      module: "GROUP_BLOCKS",
      action: "UPDATE",
      entityType: "GroupBlock",
      entityId: id,
      description:
        `Updated group block ${group.code}` +
        (data.status && data.status !== group.status ? ` — status ${group.status} → ${data.status}` : "") +
        (data.totalRoomsHeld != null && data.totalRoomsHeld !== group.totalRoomsHeld
          ? ` — rooms held ${group.totalRoomsHeld} → ${data.totalRoomsHeld}`
          : ""),
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
