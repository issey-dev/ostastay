"use client"

import { parseDateKey } from "@/lib/date-only"
import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "@/components/icons"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Drawer, DrawerBody, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"

export interface DateRangePickerProps {
  value?: DateRange
  onChange?: (date: DateRange | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  className,
  disabled
}: DateRangePickerProps) {
  // Callers often build the value from stored "yyyy-MM-dd" strings via `new Date(...)`,
  // which is UTC midnight — normalise to local midnight so the highlighted days match.
  // What goes OUT is the calendar's own local-midnight Dates: callers must serialise
  // them with toDateKey()/format(), never toISOString() (see src/lib/date-only.ts).
  // Two months side by side are ~480px — wider than a phone. One month there.
  const isMobile = useIsMobile()
  // A unique id: this used to be a hard-coded "date", duplicated wherever two pickers share
  // a page. Nothing referenced it.
  const id = React.useId()
  const range: DateRange | undefined = value
    ? { from: parseDateKey(value.from), to: parseDateKey(value.to) }
    : undefined
  const trigger = (
    <Button
      id={id}
      variant={"outline"}
      disabled={disabled}
      className={cn(
        "w-full justify-start text-left font-normal",
        !range?.from && "text-muted-foreground"
      )}
    >
      <CalendarIcon className="mr-2 h-4 w-4" />
      {range?.from ? (
        range.to ? (
          <>
            {format(range.from, "LLL dd, y")} -{" "}
            {format(range.to, "LLL dd, y")}
          </>
        ) : (
          format(range.from, "LLL dd, y")
        )
      ) : (
        <span>{placeholder}</span>
      )}
    </Button>
  )

  const calendar = (
    <Calendar
      autoFocus
      mode="range"
      defaultMonth={range?.from}
      selected={range}
      onSelect={onChange}
      numberOfMonths={isMobile ? 1 : 2}
    />
  )

  // Phones: a bottom drawer with one month and Clear / Done pinned at the bottom (a range
  // takes two taps, so the sheet stays open until Done).
  if (isMobile) {
    return (
      <div className={cn("grid gap-2", className)}>
        <Drawer>
          <DrawerTrigger render={trigger} />
          <DrawerContent initialFocus={false}>
            <DrawerHeader>
              <DrawerTitle>{placeholder}</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="flex justify-center">{calendar}</DrawerBody>
            <DrawerFooter>
              <DrawerClose render={<Button>Done</Button>} />
              {range?.from && (
                <Button variant="outline" onClick={() => onChange?.(undefined)}>Clear</Button>
              )}
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    )
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {calendar}
        </PopoverContent>
      </Popover>
    </div>
  )
}
