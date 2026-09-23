import { requireSession, requireHubAccess, requirePermission, hasPermission } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { InfoHint } from "@/components/ui/info-hint"
import { GreenTaxRegister } from "@/components/hub/green-tax-register"

// Green Tax Registrations — the yearly Reg No register per property: corrections (with
// the gap-free renumbering they imply) and monthly MIRA filing, which locks a month.
// Rules: src/lib/green-tax-registry.ts; DECISIONS "Green Tax Report = MIRA information
// sheet". Takes an explicit property (the Hub has no current property).
export default async function HubGreenTaxPage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)
  requirePermission(ctx, "GREEN_TAX", "view")

  const properties = await prisma.property.findMany({
    where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          Green Tax Registrations
          <InfoHint label="Green Tax Registrations">
            Every guest who stays 12 hours or more in a real room gets the next Reg No at
            Night Audit, numbered from 1 each year in check-in order with no gaps. Correct
            mistakes here, then mark each month as filed once it is submitted to MIRA.
          </InfoHint>
        </h2>
        <p className="mt-1 text-muted-foreground">Review and correct the Reg No sequence, and record each month&apos;s MIRA filing.</p>
      </div>
      <GreenTaxRegister properties={properties} canManage={hasPermission(ctx, "GREEN_TAX", "update")} />
    </div>
  )
}
