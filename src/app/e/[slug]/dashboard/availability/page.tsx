import { Card, CardContent } from "@/components/ui/card";
import { AvailabilityGrid } from "@/components/availability/availability-grid";
import { PageHeader } from "@/components/ui/page-header"

export default function AvailabilityPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Availability"
        hint="Available rooms by date and room type. Each column is the night of that date. Expand a row for arrivals, occupancy, departures and headcount, or set Stop Sale restrictions — closed (Stop Sale) dates block new bookings."
      />

      <Card className="border-0 shadow-lg ring-1 ring-border">
        <CardContent className="p-0 overflow-hidden">
          <AvailabilityGrid />
        </CardContent>
      </Card>
    </div>
  );
}
