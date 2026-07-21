import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "HOUSEKEEPING", "create")

    const body = await request.json()
    const { roomId, notes, priority = "NORMAL" } = body

    if (!roomId || !notes) {
      return NextResponse.json({ error: "roomId and notes are required" }, { status: 400 })
    }

    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { roomType: true } })
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, room.propertyId)
    if (!room.roomType.housekeepingEnabled) {
      return NextResponse.json({ error: "This room's room type does not offer housekeeping" }, { status: 400 })
    }

    const task = await prisma.housekeepingTask.create({
      data: {
        roomId,
        taskType: "SPECIAL_REQUEST",
        status: "PENDING",
        priority,
        notes,
        scheduledDate: new Date()
      }
    })

    await logActivity({
      ctx,
      module: "HOUSEKEEPING",
      action: "CREATE",
      entityType: "HousekeepingTask",
      entityId: task.id,
      description: `Created special request for room ${room.roomNumber}: ${notes}`,
    })

    return NextResponse.json(task, { status: 201 })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "HOUSEKEEPING", "update")

    const body = await request.json()
    const { taskId, status } = body

    if (!taskId || !status) {
      return NextResponse.json({ error: "taskId and status are required" }, { status: 400 })
    }
    const VALID_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"]
    if (!VALID_TASK_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid task status — expected one of ${VALID_TASK_STATUSES.join(", ")}` }, { status: 400 })
    }

    const existing = await prisma.housekeepingTask.findUnique({
      where: { id: taskId },
      include: { room: true }
    })
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.room.propertyId)

    const task = await prisma.housekeepingTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null
      }
    })

    // Completing a cleaning task (CHECKOUT etc. — anything but a special request)
    // means the room is clean: flip a DIRTY room to CLEAN. INSPECTED is never
    // set here (that's a supervisor's explicit call) and OOO/OOS are untouched.
    let roomStatusUpdated = false
    if (status === "COMPLETED" && existing.taskType !== "SPECIAL_REQUEST" && existing.room.status === "DIRTY") {
      await prisma.room.update({ where: { id: existing.roomId }, data: { status: "CLEAN" } })
      roomStatusUpdated = true
    }

    await logActivity({
      ctx,
      module: "HOUSEKEEPING",
      action: "UPDATE",
      entityType: "HousekeepingTask",
      entityId: task.id,
      description: `Set housekeeping task for room ${existing.room.roomNumber} to ${status}${roomStatusUpdated ? " (room marked CLEAN)" : ""}`,
    })

    return NextResponse.json({ ...task, roomStatusUpdated })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
