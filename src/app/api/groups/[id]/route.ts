import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
        }
      }
    })

    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })

    return NextResponse.json(group)
  } catch (error) {
    console.error("Error fetching group:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
