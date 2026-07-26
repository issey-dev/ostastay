"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Ban, DoorOpen } from "@/components/icons";

export type RoomTypeOption = { id: string; code: string; name: string };

export type StopSaleInitial = {
  // Pre-select a single room type (its row's cell was clicked); null/undefined = property-wide.
  roomTypeId?: string | null;
  // Pre-fill the range with a single clicked date.
  date?: string;
};

export function StopSaleDialog({
  open,
  onClose,
  propertyId,
  roomTypes,
  initial,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  roomTypes: RoomTypeOption[];
  initial?: StopSaleInitial;
  onDone: () => void;
}) {
  const [propertyWide, setPropertyWide] = useState(false);
  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the dialog opens, seeding it from the clicked cell.
  useEffect(() => {
    if (!open) return;
    const wide = initial?.roomTypeId == null;
    setPropertyWide(wide);
    setSelectedTypeIds(new Set(wide ? [] : [initial!.roomTypeId as string]));
    const d = initial?.date ? new Date(initial.date) : undefined;
    setRange(d ? { from: d, to: d } : undefined);
  }, [open, initial]);

  const toggleType = (id: string) => {
    setSelectedTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (mode: "CLOSE" | "OPEN") => {
    if (!range?.from) {
      toast.error("Pick a date range first.");
      return;
    }
    if (!propertyWide && selectedTypeIds.size === 0) {
      toast.error("Select at least one room type, or choose Property-wide.");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        propertyId,
        startDate: format(range.from, "yyyy-MM-dd"),
        endDate: format(range.to ?? range.from, "yyyy-MM-dd"),
        roomTypeIds: propertyWide ? [] : [...selectedTypeIds],
      };
      const res = await fetch("/api/availability/restrictions", {
        method: mode === "CLOSE" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to update Stop Sale.");
        return;
      }
      toast.success(
        mode === "CLOSE"
          ? `Closed ${json.closed} date(s) for sale.`
          : `Reopened ${json.opened} date(s) for sale.`
      );
      onDone();
      onClose();
    } catch {
      toast.error("An error occurred while updating Stop Sale.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Stop Sale — Availability Restrictions</DialogTitle>
          <DialogDescription>
            Close dates to sale (Stop Sale) or reopen them. Closed dates hard-block new
            reservations for the chosen scope.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <Label className="text-sm font-medium">Date range</Label>
            <DateRangePicker
              value={range}
              onChange={setRange}
              className="mt-1.5"
              placeholder="Pick the dates to close/open"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Property-wide</Label>
              <p className="text-xs text-muted-foreground">Applies to every room type on those dates.</p>
            </div>
            <Switch checked={propertyWide} onCheckedChange={setPropertyWide} />
          </div>

          {!propertyWide && (
            <div>
              <Label className="text-sm font-medium">Room types</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {roomTypes.map((t) => {
                  const active = selectedTypeIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(t.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                      )}
                    >
                      {t.code} · {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => submit("OPEN")}
              disabled={submitting}
              className="bg-success-muted text-success hover:bg-success-muted/70 border-success/30"
            >
              <DoorOpen className="mr-2 h-4 w-4" /> Open
            </Button>
            <Button
              onClick={() => submit("CLOSE")}
              disabled={submitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Ban className="mr-2 h-4 w-4" /> Close (Stop Sale)
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
