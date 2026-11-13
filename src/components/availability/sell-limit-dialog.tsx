"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { z } from "zod";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "@/lib/toast";
import { apiError } from "@/lib/api-error";
import type { RoomTypeOption } from "./stop-sale-dialog";

// Sell limit editor (Agent Portal plan A-10). How many rooms past capacity the desk may sell
// on each night of a range, for one room type or the whole house. Leaving the number empty
// clears the limit (back to: no cap). Past a limit, only a manager can book.

const HOUSE = "__house__";

const schema = z
  .object({
    roomTypeId: z.string().min(1, "Pick a room type or the whole house"),
    range: z.object({ from: z.date().optional(), to: z.date().optional() }).optional(),
    extraRooms: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 500), "A whole number from 0 to 500, or empty to clear"),
  })
  .refine((v) => !!v.range?.from, { message: "Pick the nights", path: ["range"] });

type Values = z.infer<typeof schema>;

export function SellLimitDialog({
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
  initial?: { roomTypeId?: string | null; date?: string; extraRooms?: number | null };
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { roomTypeId: HOUSE, range: undefined, extraRooms: "" },
  });

  useEffect(() => {
    if (!open) return;
    const d = initial?.date ? new Date(initial.date) : undefined;
    form.reset({
      roomTypeId: initial?.roomTypeId ?? HOUSE,
      range: d ? { from: d, to: d } : undefined,
      extraRooms: initial?.extraRooms === null || initial?.extraRooms === undefined ? "" : String(initial.extraRooms),
    });
  }, [open, initial, form]);

  const submit = form.handleSubmit(async (v) => {
    setSaving(true);
    try {
      const from = format(v.range!.from!, "yyyy-MM-dd");
      const to = format(v.range!.to ?? v.range!.from!, "yyyy-MM-dd");
      const res = await fetch("/api/availability/sell-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          roomTypeId: v.roomTypeId === HOUSE ? null : v.roomTypeId,
          from,
          to,
          extraRooms: v.extraRooms === "" ? null : Number(v.extraRooms),
        }),
      });
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't save the sell limit. Try again."));
        return;
      }
      toast.success(v.extraRooms === "" ? "Sell limit cleared" : `Sell limit set to ${v.extraRooms} over capacity`);
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  });

  const err = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" mobile="sheet">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Sell limit</DialogTitle>
            <DialogDescription>
              How many rooms past capacity the desk may sell on these nights. Leave it empty to remove the limit. Channels, the
              booking website and agents never oversell.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Applies to</Label>
              <Controller
                control={form.control}
                name="roomTypeId"
                render={({ field }) => (
                  <SearchableSelect
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Room type"
                    options={[{ label: "Whole house", value: HOUSE }, ...roomTypes.map((t) => ({ label: `${t.code} · ${t.name}`, value: t.id }))]}
                  />
                )}
              />
              {err.roomTypeId && <p className="text-xs text-destructive">{err.roomTypeId.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Nights</Label>
              <Controller
                control={form.control}
                name="range"
                render={({ field }) => (
                  <DateRangePicker value={field.value as DateRange | undefined} onChange={field.onChange} placeholder="Pick the nights" />
                )}
              />
              {err.range && <p className="text-xs text-destructive">{err.range.message as string}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="extraRooms">Rooms past capacity</Label>
              <Input id="extraRooms" inputMode="numeric" placeholder="e.g. 2 (empty = no limit)" {...form.register("extraRooms")} />
              {err.extraRooms && <p className="text-xs text-destructive">{err.extraRooms.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.formState.isValid}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
