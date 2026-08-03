import { EnterprisesList } from "@/components/osta/enterprises-list"
import { InfoHint } from "@/components/ui/info-hint"

export default function OstaEnterprisesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Enterprises
            <InfoHint label="Enterprises">Every customer enterprise registered on the platform.</InfoHint>
          </h2>
      </div>
      <EnterprisesList />
    </div>
  )
}
