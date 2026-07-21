import { EnterprisesList } from "@/components/osta/enterprises-list"

export default function OstaEnterprisesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Enterprises</h2>
        <p className="text-muted-foreground">Every customer enterprise registered on the platform.</p>
      </div>
      <EnterprisesList />
    </div>
  )
}
