import { notFound } from "next/navigation"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Badge } from "@/components/ui/badge"

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
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{enterprise.name}</h2>
        <p className="text-muted-foreground">/e/{enterprise.slug} · {enterprise._count.users} user{enterprise._count.users === 1 ? "" : "s"}</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Properties</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {enterprise.properties.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No properties yet.</p>
          ) : (
            enterprise.properties.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                <span className="text-sm font-medium">{p.name} <span className="text-muted-foreground font-mono text-xs">({p.code})</span></span>
                <StatusBadge label={p.status} status={p.status} dot />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
