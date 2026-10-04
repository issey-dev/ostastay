import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handle, opsGate, propertyIdFrom } from "@/lib/transport/http"

// GET /api/transport/staff?propertyId= — who can be assigned as an airport rep: active staff
// working at this property or across all properties. Minimal fields, like /api/staff.
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    const { ctx } = await opsGate(propertyId, "view")
    const users = await prisma.user.findMany({
      where: { enterpriseId: ctx.enterpriseId, isActive: true, isSystem: false, OR: [{ scope: "ENTERPRISE" }, { propertyId }] },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, jobFunction: true },
    })
    return NextResponse.json(users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), jobFunction: u.jobFunction })))
  })
}
