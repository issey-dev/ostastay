import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TapeChartGrid } from "@/components/reservations/tape-chart-grid";

export default function TapeChartPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">Availability Matrix</h2>
        <p className="text-slate-500 mt-2">
          Drag and drop to manage room inventory across dates.
        </p>
      </div>

      <Card className="border-0 shadow-lg ring-1 ring-slate-200">
        <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
          <CardTitle className="text-lg text-slate-800">Tape Chart</CardTitle>
          <CardDescription>View and manage all reservations spanning the next 14 days.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <TapeChartGrid />
        </CardContent>
      </Card>
    </div>
  );
}
