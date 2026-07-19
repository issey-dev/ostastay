import { StationariesManager } from "@/components/settings/stationaries-manager"

export default function StationariesPage() {
  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Stationaries</h2>
        <p className="text-sm text-muted-foreground">
          Branding, layout, and content for every printable/emailable document — Invoices, Confirmation Letters, Payment Receipts, Currency Exchange Receipts, and Debtor Statements.
        </p>
      </div>
      <StationariesManager />
    </div>
  )
}
