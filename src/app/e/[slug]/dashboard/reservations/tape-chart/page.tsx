import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TapeChartGrid } from "@/components/reservations/tape-chart-grid";

export default function TapeChartPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Availability Matrix</h2>
        <p className="text-muted-foreground mt-2">
          Drag and drop to manage room inventory across dates.
        </p>
      </div>

      <Card className="border-0 shadow-lg ring-1 ring-border">
        <CardHeader className="bg-muted border-b border-border pb-4">
          <CardTitle className="text-lg text-foreground">Tape Chart</CardTitle>
          <CardDescription>View and manage all reservations spanning the next 14 days.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <TapeChartGrid />
        </CardContent>
      </Card>
    </div>
  );
}
