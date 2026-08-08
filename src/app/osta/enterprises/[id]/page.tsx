import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ReceiptText } from "@/components/icons"
import { EnterpriseAddonAccessManager } from "@/components/osta/enterprise-addon-access-manager"
import { EnterpriseOnboardingActions } from "@/components/osta/enterprise-onboarding-actions"
import { computeLicenseState } from "@/lib/license"

const LICENSE_STATE_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  GRACE: "Grace Period",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  UNLICENSED: "Unlicensed",
}

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"
}

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default async function OstaEnterpriseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const enterprise = await prisma.enterprise.findUnique({
    where: { id },
    include: {
      license: true,
      properties: { orderBy: { createdAt: "desc" } },
      licenseInvoices: { orderBy: { issuedAt: "desc" }, take: 5 },
      _count: { select: { users: true, properties: true } },
    },
  })
  if (!enterprise || enterprise.type !== "STANDARD") notFound()

  const { state, graceEndsAt } = computeLicenseState(enterprise.license)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">{enterprise.name}</h2>
          <p className="text-muted-foreground">/e/{enterprise.slug} · {enterprise._count.users} user{enterprise._count.users === 1 ? "" : "s"}</p>
        </div>
        <EnterpriseOnboardingActions
          enterpriseId={enterprise.id}
          enterpriseName={enterprise.name}
          userCount={enterprise._count.users}
          propertyCount={enterprise._count.properties}
          maxProperties={enterprise.license?.maxProperties ?? 1}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">License</CardTitle>
            <StatusBadge label={LICENSE_STATE_LABELS[state]} status={state} dot />
          </div>
          <CardDescription>
            {enterprise._count.properties} of {enterprise.license?.maxProperties ?? 1} allowed propert{(enterprise.license?.maxProperties ?? 1) === 1 ? "y" : "ies"} used.
            Manage validity, price, and per-property allowances from <a href="/osta/licensing" className="underline">Licensing</a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Monthly Price</dt>
              <dd className="font-medium">
                {enterprise.license?.monthlyPrice ? fmtMoney(enterprise.license.monthlyPrice, enterprise.license.priceCurrency) : "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Valid Until</dt>
              <dd className="font-medium">{enterprise.license?.expiresAt ? fmtDate(enterprise.license.expiresAt) : "No expiry"}</dd>
            </div>
            {state === "GRACE" && (
              <div>
                <dt className="text-muted-foreground">Grace Ends</dt>
                <dd className="font-medium text-warning">{fmtDate(graceEndsAt)}</dd>
              </div>
            )}
          </dl>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <ReceiptText className="h-3.5 w-3.5" /> Recent Invoices
              </h4>
              <a href="/osta/licensing" className="text-xs text-primary hover:underline">View all in Licensing</a>
            </div>
            {enterprise.licenseInvoices.length === 0 ? (
              <EmptyState icon={ReceiptText} title="No invoices issued yet" />
            ) : (
              <div className="flex flex-col gap-1">
                {enterprise.licenseInvoices.map((inv) => (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{inv.invoiceNo}</span>
                      <span className="text-muted-foreground shrink-0">{fmtDate(inv.issuedAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium tabular-nums">{fmtMoney(inv.amount, inv.currency)}</span>
                      <StatusBadge label={inv.status} status={inv.status} dot />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <EnterpriseAddonAccessManager enterpriseId={enterprise.id} enterpriseName={enterprise.name} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Properties</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {enterprise.properties.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No properties yet.</p>
          ) : (
            enterprise.properties.map((p) => (
              <Link
                key={p.id}
                href={`/osta/properties/${p.id}`}
                className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0 hover:bg-muted/50 -mx-2 px-2 rounded-none"
              >
                <span className="text-sm font-medium">{p.name} <span className="text-muted-foreground font-mono text-xs">({p.code})</span></span>
                <StatusBadge label={p.status} status={p.status} dot />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
