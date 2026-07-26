"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "@/components/icons"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  value?: string | Date | null
  onChange: (date: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Hard floor — days before this are not selectable in the calendar at all (e.g. a
   * Departure picker's minDate = Arrival + 1 day, so an invalid range can't be picked
   * in the first place, not just rejected after the fact). */
  minDate?: string | Date | null
  /** Hard ceiling — days after this are not selectable (e.g. a group pickup can't check
   * out past the block's end date). */
  maxDate?: string | Date | null
  /** When provided, only these days (yyyy-MM-dd) are selectable — every other day is
   * grayed out. Used where the valid dates are a known, non-contiguous set rather than
   * a simple floor (e.g. an excursion's actual scheduled departure days). */
  availableDates?: string[]
}

export function DatePicker({ value, onChange, placeholder = "Pick a date", className, disabled, minDate, maxDate, availableDates }: DatePickerProps) {
  // Try to parse the incoming value securely
  const dateValue = typeof value === 'string' && value ? new Date(value) : (value instanceof Date ? value : undefined)
  const minDateValue = typeof minDate === 'string' && minDate ? new Date(minDate) : (minDate instanceof Date ? minDate : undefined)
  const maxDateValue = typeof maxDate === 'string' && maxDate ? new Date(maxDate) : (maxDate instanceof Date ? maxDate : undefined)
  const availableSet = availableDates ? new Set(availableDates) : null

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      // Format to YYYY-MM-DD to easily store in form states
      onChange(format(date, "yyyy-MM-dd"))
    } else {
      onChange("")
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !dateValue && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {dateValue ? format(dateValue, "dd MMM yyyy").toUpperCase() : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          disabled={
            availableSet
              ? (date: Date) =>
                  (minDateValue ? date < minDateValue : false) ||
                  (maxDateValue ? date > maxDateValue : false) ||
                  !availableSet.has(format(date, "yyyy-MM-dd"))
              : [
                  ...(minDateValue ? [{ before: minDateValue }] : []),
                  ...(maxDateValue ? [{ after: maxDateValue }] : []),
                ]
          }
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
