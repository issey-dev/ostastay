import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvailabilityGrid } from "@/components/availability/availability-grid";
import { InfoHint } from "@/components/ui/info-hint"

export default function AvailabilityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl text-foreground">
            Property Availability
            <InfoHint label="Property Availability">Available rooms by date and room type. Expand a row for arrivals, occupancy, departures and headcount, or set Stop Sale restrictions.</InfoHint>
          </h2>
      </div>

      <Card className="border-0 shadow-lg ring-1 ring-border">
        <CardHeader className="bg-muted border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-foreground">
            Availability
            <InfoHint label="Availability">Each column is the night of that date. Closed (Stop Sale) dates block new bookings.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <AvailabilityGrid />
        </CardContent>
      </Card>
    </div>
  );
}
