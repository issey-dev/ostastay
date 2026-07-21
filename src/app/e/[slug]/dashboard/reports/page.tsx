"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar"; // assuming a Calendar component exists
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function ReportsPage() {
  const [date, setDate] = useState(new Date());
  const [printMode, setPrintMode] = useState<null | 'arrival' | 'departure'>(null);

  const isoDate = date.toISOString().split('T')[0];

  const openPdf = (type: 'arrival' | 'departure') => {
    const url = `/api/reports/${type}-pdf?date=${isoDate}`;
    window.open(url, "_blank");
  };

  const openPrint = (type: 'arrival' | 'departure') => {
    setPrintMode(type);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h2 className="text-3xl font-bold tracking-tight">Daily Arrival & Departure Reports</h2>
      <div className="flex items-center space-x-4">
        <Calendar
          mode="single"
          required
          selected={date}
          onSelect={setDate}
          defaultMonth={date}
        />
        <p className="text-sm text-muted-foreground">Selected date: {format(date, "PPP")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Arrival Card */}
        <Card className="border-border shadow-md">
          <CardHeader className="bg-muted border-b border-border">
            <CardTitle>Arrival List</CardTitle>
            <CardDescription>Guests scheduled to check‑in today.</CardDescription>
          </CardHeader>
          <CardContent className="py-6 flex flex-col gap-4">
            <Button onClick={() => openPdf('arrival')}>
              Generate PDF
            </Button>
            <Button variant="outline" onClick={() => openPrint('arrival')}>
              Printable View
            </Button>
          </CardContent>
        </Card>

        {/* Departure Card */}
        <Card className="border-border shadow-md">
          <CardHeader className="bg-muted border-b border-border">
            <CardTitle>Departure List</CardTitle>
            <CardDescription>Guests checking out today with balance due.</CardDescription>
          </CardHeader>
          <CardContent className="py-6 flex flex-col gap-4">
            <Button onClick={() => openPdf('departure')}>
              Generate PDF
            </Button>
            <Button variant="outline" onClick={() => openPrint('departure')}>
              Printable View
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Printable Modal */}
      <Dialog open={!!printMode} onOpenChange={() => setPrintMode(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{printMode === 'arrival' ? 'Arrival List' : 'Departure List'} – {format(date, "PPP")}</DialogTitle>
            <DialogDescription>Print this view using your browser’s print dialog.</DialogDescription>
          </DialogHeader>
          {/* The actual table will be rendered client‑side via a small component */}
          {printMode && (
            <PrintableReport type={printMode} date={date} />
          )}
          <DialogFooter>
            <Button onClick={() => window.print()}>Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Simple printable component – fetches the same data as the PDF APIs but renders a table.
function PrintableReport({ type, date }: { type: 'arrival' | 'departure'; date: Date }) {
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const iso = date.toISOString().split('T')[0];
      const res = await fetch(`/api/reports/${type}-pdf?date=${iso}&format=json`);
      if (res.ok) {
        const json = await res.json();
        setRows(json.rows);
      }
      setLoading(false);
    };
    fetchData();
  }, [type, date]);

  const headers = type === 'arrival'
    ? ['Guest', 'Confirmation #', 'Room Type', 'Room', 'Arrival']
    : ['Guest', 'Confirmation #', 'Room Type', 'Room', 'Departure', 'Balance Due'];

  return (
    <div className="overflow-x-auto">
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="min-w-full border-collapse">
          <thead className="bg-muted">
            <tr>
              {headers.map(h => (<th key={h} className="border p-2 text-left font-medium">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-card' : 'bg-muted'}>
                {row.map((cell, j) => (<td key={j} className="border p-2">{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
