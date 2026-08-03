import { LicensingManager } from "@/components/controls/licensing-manager"
import { InfoHint } from "@/components/ui/info-hint"

export default function OstaLicensingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            Licensing
            <InfoHint label="Licensing">Each enterprise&apos;s license: validity and price, per-property attribute caps, invoices, and module access.</InfoHint>
          </h2>
      </div>
      <LicensingManager />
    </div>
  )
}
