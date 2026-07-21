"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building2 } from "lucide-react"

type EnterpriseRow = {
  id: string
  name: string
  slug: string
  license: { tier: string; maxProperties: number } | null
  _count: { properties: number; users: number }
}

export function EnterprisesList() {
  const [enterprises, setEnterprises] = useState<EnterpriseRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/enterprises")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setEnterprises(data) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-muted-foreground italic">Loading...</p>
  if (enterprises.length === 0) {
    return <p className="text-sm text-muted-foreground italic py-8 text-center border rounded-md bg-muted/40">No customer enterprises yet.</p>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {enterprises.map((e) => (
        <a key={e.id} href={`/osta/enterprises/${e.id}`}>
          <Card className="hover:bg-muted/40 transition-colors h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /> {e.name}</CardTitle>
              <CardDescription>/e/{e.slug}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{e.license?.tier ?? "STANDARD"}</Badge>
              <span>{e._count.properties} propert{e._count.properties === 1 ? "y" : "ies"}</span>
              <span>·</span>
              <span>{e._count.users} user{e._count.users === 1 ? "" : "s"}</span>
            </CardContent>
          </Card>
        </a>
      ))}
    </div>
  )
}
