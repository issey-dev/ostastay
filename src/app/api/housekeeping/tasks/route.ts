import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { roomId, notes, priority = "NORMAL" } = body

    if (!roomId || !notes) {
      return NextResponse.json({ error: "roomId and notes are required" }, { status: 400 })
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

    return NextResponse.json(task, { status: 201 })
  } catch (error) {
    console.error("Error creating task:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { taskId, status } = body

    if (!taskId || !status) {
      return NextResponse.json({ error: "taskId and status are required" }, { status: 400 })
    }

    const task = await prisma.housekeepingTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null
      }
    })

    return NextResponse.json(task)
  } catch (error) {
    console.error("Error updating task:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
