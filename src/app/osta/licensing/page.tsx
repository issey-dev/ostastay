import { LicensingManager } from "@/components/controls/licensing-manager"
import { PageHeader } from "@/components/ui/page-header"
import { DesktopOnlyNotice } from "@/components/ui/mobile"

export default function OstaLicensingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Licensing" tabTitle="Licensing · Osta" hint={<>Each enterprise&apos;s license: validity and price, per-property attribute caps, invoices, and module access.</>} />
      <DesktopOnlyNotice feature="Licensing" description="You can still read everything below. To make changes comfortably, open the console on a tablet or computer." />
      <LicensingManager />
    </div>
  )
}
