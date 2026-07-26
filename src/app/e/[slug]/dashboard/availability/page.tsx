import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvailabilityGrid } from "@/components/availability/availability-grid";

export default function AvailabilityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Property Availability</h2>
        <p className="text-muted-foreground mt-2">
          Available rooms by date and room type. Expand a row for arrivals, occupancy,
          departures and headcount, or set Stop Sale restrictions.
        </p>
      </div>

      <Card className="border-0 shadow-lg ring-1 ring-border">
        <CardHeader className="bg-muted border-b border-border pb-4">
          <CardTitle className="text-lg text-foreground">Availability</CardTitle>
          <CardDescription>
            Each column is the night of that date. Closed (Stop Sale) dates block new bookings.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <AvailabilityGrid />
        </CardContent>
      </Card>
    </div>
  );
}
