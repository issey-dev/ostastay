import { NextResponse } from "next/server"
import { assertPropertyAccess, hasPermission, requireSession } from "@/lib/scope"
import { handle, propertyIdFrom } from "@/lib/transport/http"
import { getTransportSettings } from "@/lib/transport/common"

// GET /api/transport/access?propertyId= — whether Transportation is on at this property and
// what the signed-in user may do with it. Lets a page that is not the board (the
// reservation's Transportation card) show the right card and only the actions allowed.
// Every action route still checks for itself.
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    const ctx = await requireSession()
    await assertPropertyAccess(ctx, propertyId)
    const settings = await getTransportSettings(propertyId)
    return NextResponse.json({
      enabled: settings.enabled,
      perms: {
        view: hasPermission(ctx, "TRANSPORTATION", "view"),
        manageBookings: hasPermission(ctx, "TRANSPORTATION", "create"),
        manageManifests: hasPermission(ctx, "TRANSPORTATION", "update"),
        canBill: hasPermission(ctx, "TRANSPORTATION", "delete"),
        canVoid: hasPermission(ctx, "CASHIERING", "update"),
      },
    })
  })
}
