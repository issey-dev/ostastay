import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Badge } from "@/components/ui/badge"
import { EnterpriseAddonAccessManager } from "@/components/osta/enterprise-addon-access-manager"
import { EnterpriseOnboardingActions } from "@/components/osta/enterprise-onboarding-actions"

export default async function OstaEnterpriseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const enterprise = await prisma.enterprise.findUnique({
    where: { id },
    include: {
      license: true,
      properties: { orderBy: { createdAt: "desc" } },
      _count: { select: { users: true, properties: true } },
    },
  })
  if (!enterprise || enterprise.type !== "STANDARD") notFound()

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
          <CardTitle className="text-lg">License</CardTitle>
          <CardDescription>
            {enterprise._count.properties} of {enterprise.license?.maxProperties ?? 1} allowed propert{(enterprise.license?.maxProperties ?? 1) === 1 ? "y" : "ies"} used.
            Manage tier and per-enterprise module overrides from <a href="/osta/licensing" className="underline">Licensing</a>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">{enterprise.license?.tier ?? "STANDARD"}</Badge>
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
