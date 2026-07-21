import { Building2, ClipboardCheck, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { prisma } from "@/lib/db"

export default async function OstaOverviewPage() {
  const [enterpriseCount, pendingPropertyCount, activeGrantCount] = await Promise.all([
    prisma.enterprise.count({ where: { type: "STANDARD" } }),
    prisma.property.count({ where: { status: "PENDING" } }),
    prisma.supportAccessGrant.count({ where: { status: "APPROVED" } }),
  ])

  const cards = [
    { title: "Enterprises", value: enterpriseCount, icon: Building2, href: "/osta/enterprises" },
    { title: "Pending Property Approvals", value: pendingPropertyCount, icon: ClipboardCheck, href: "/osta/properties" },
    { title: "Active Support Grants", value: activeGrantCount, icon: ShieldCheck, href: "/osta/support-access" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">Every enterprise, property, and support grant on the platform, in one place.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <a key={c.title} href={c.href}>
            <Card className="shadow-elevation-1 hover:bg-muted/40 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{c.value}</div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  )
}
