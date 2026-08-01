import { LicensingManager } from "@/components/controls/licensing-manager"

export default function OstaLicensingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Licensing</h2>
        <p className="text-muted-foreground">
          Each enterprise&apos;s license: validity and price, per-property attribute caps, invoices, and module access.
        </p>
      </div>
      <LicensingManager />
    </div>
  )
}
