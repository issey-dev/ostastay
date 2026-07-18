import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
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
    await assertPropertyAccess(ctx, group.propertyId)

    return NextResponse.json(group)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
