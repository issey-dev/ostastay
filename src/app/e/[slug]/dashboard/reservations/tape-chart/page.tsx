import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TapeChartGrid } from "@/components/reservations/tape-chart-grid";
import { InfoHint } from "@/components/ui/info-hint"

export default function TapeChartPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-foreground">
            Availability Matrix
            <InfoHint label="Availability Matrix">Drag and drop to manage room inventory across dates.</InfoHint>
          </h2>
      </div>

      <Card className="border-0 shadow-lg ring-1 ring-border">
        <CardHeader className="bg-muted border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-foreground">
            Tape Chart
            <InfoHint label="Tape Chart">View and manage all reservations spanning the next 14 days.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <TapeChartGrid />
        </CardContent>
      </Card>
    </div>
  );
}
