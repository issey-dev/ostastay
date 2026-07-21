import { LicensingManager } from "@/components/controls/licensing-manager"

export default function OstaLicensingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Licensing</h2>
        <p className="text-muted-foreground">
          Control how many properties each enterprise may create, and which modules their plan tier includes.
        </p>
      </div>
      <LicensingManager />
    </div>
  )
}
