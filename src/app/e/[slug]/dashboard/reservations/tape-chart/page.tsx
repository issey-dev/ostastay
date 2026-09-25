import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TapeChartGrid } from "@/components/reservations/tape-chart-grid";
import { PageHeader } from "@/components/ui/page-header"

// Page title follows the sidebar label ("Tape Chart") — DECISIONS 2026-09-25 "Desktop polish".
export default function TapeChartPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tape Chart"
        hint="Reservations across the chosen window (7, 14 or 30 days). Drag a bar onto another room to move it; click an empty cell to book that room."
      />

      <Card className="border-0 py-0 shadow-lg ring-1 ring-border">
        <CardContent className="p-0 overflow-hidden">
          {/* The grid keeps its day window in the URL (?days=) — useSearchParams needs a
              Suspense boundary above it. */}
          <Suspense fallback={null}>
            <TapeChartGrid />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
