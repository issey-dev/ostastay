import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { PageHeader } from "@/components/ui/page-header"

export default async function OstaPropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const property = await prisma.property.findUnique({
    where: { id },
    include: { enterprise: { select: { id: true, name: true, slug: true } } },
  })
  if (!property) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/osta/enterprises/${property.enterprise.id}`} className="text-sm text-muted-foreground hover:underline">
          &larr; {property.enterprise.name}
        </Link>
        <PageHeader
          className="mt-1"
          title={
            <>
              {property.name}
              <StatusBadge label={property.status} status={property.status} dot />
            </>
          }
          tabTitle={`${property.name} · Osta`}
          description={<span className="font-mono">{property.code}</span>}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Property</CardTitle>
          <CardDescription>{property.legalName}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>{property.defaultCurrency} · {property.timeZone}</p>
          <p>Check-in {property.checkInTime} · Check-out {property.checkOutTime}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add-ons</CardTitle>
          <CardDescription>
            Add-ons (Spa, Excursions) are sold and enabled per enterprise — manage them on{" "}
            <Link href={`/osta/enterprises/${property.enterprise.id}`} className="underline">{property.enterprise.name}</Link>.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
