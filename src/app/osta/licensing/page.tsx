import { LicensingManager } from "@/components/controls/licensing-manager"
import { InfoHint } from "@/components/ui/info-hint"
import { DesktopOnlyNotice } from "@/components/ui/mobile"

export default function OstaLicensingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Licensing
            <InfoHint label="Licensing">Each enterprise&apos;s license: validity and price, per-property attribute caps, invoices, and module access.</InfoHint>
          </h2>
      </div>
      <DesktopOnlyNotice feature="Licensing" description="You can still read everything below. To make changes comfortably, open the console on a tablet or computer." />
      <LicensingManager />
    </div>
  )
}
