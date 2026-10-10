"use client"

import { useEffect, useMemo, useRef } from "react"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { parseDateKey, toDateKey } from "@/lib/date-only"
import { ChevronDown } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchableSelect } from "@/components/ui/searchable-select"

// A report's parameters as one compact bar above the results. Built from the report's own
// `params` (so a new report needs no UI work), validated with Zod + React Hook Form as per
// APP STANDARD 001, and applied automatically — a valid change re-runs the report after a
// short pause, so there is no separate "Preview" step.

export type ReportParam = {
  key: string
  label: string
  type: "date" | "dateRange" | "select" | "multiSelect" | "boolean"
  required?: boolean
  help?: string
  options?: { label: string; value: string }[]
  optionSource?: string
  defaultToday?: boolean
}
export type ParamValues = Record<string, unknown>
type Opt = { label: string; value: string }

const rangeValue = z.object({ from: z.string(), to: z.string() })

export function buildParamSchema(params: ReportParam[]) {
  const shape: Record<string, z.ZodType> = {}
  for (const p of params) {
    switch (p.type) {
      case "date":
        shape[p.key] = p.required ? z.string().min(1, `${p.label} is required`) : z.string()
        break
      case "dateRange":
        shape[p.key] = rangeValue
          .refine((r) => !p.required || (!!r.from && !!r.to), { message: `${p.label} is required` })
          .refine((r) => !r.from || !r.to || r.from <= r.to, { message: "The end date can't be before the start date" })
        break
      case "multiSelect":
        shape[p.key] = p.required ? z.array(z.string()).min(1, `Choose at least one ${p.label.toLowerCase()}`) : z.array(z.string())
        break
      case "boolean":
        shape[p.key] = z.boolean()
        break
      default:
        shape[p.key] = p.required ? z.string().min(1, `${p.label} is required`) : z.string()
    }
  }
  return z.object(shape)
}

/** Starting values for a report: "today" is the property's BUSINESS date, not the computer's. */
export function defaultParamValues(params: ReportParam[], today: string): ParamValues {
  const init: ParamValues = {}
  for (const p of params) {
    if (p.type === "date") init[p.key] = p.defaultToday ? today : ""
    else if (p.type === "dateRange") init[p.key] = p.defaultToday ? { from: today, to: today } : { from: "", to: "" }
    else if (p.type === "multiSelect") init[p.key] = []
    else if (p.type === "boolean") init[p.key] = false
    else init[p.key] = ""
  }
  return init
}

export function ReportFilterBar({
  params,
  initialValues,
  dynOptions,
  busy,
  onChange,
}: {
  params: ReportParam[]
  initialValues: ParamValues
  dynOptions: Record<string, Opt[]>
  busy: boolean
  /** Called with valid values: once on mount, then after each change settles. */
  onChange: (values: ParamValues) => void
}) {
  const schema = useMemo(() => buildParamSchema(params), [params])
  const form = useForm<ParamValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ParamValues>,
    mode: "onChange",
    defaultValues: initialValues,
  })
  const values = useWatch({ control: form.control }) as ParamValues
  const first = useRef(true)

  useEffect(() => {
    const t = setTimeout(
      async () => {
        // Validate the settled values; only a valid set runs the report.
        if (await form.trigger()) onChange(form.getValues())
      },
      first.current ? 0 : 450
    )
    first.current = false
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values)])

  if (params.length === 0) return null
  const options = (p: ReportParam): Opt[] => p.options ?? dynOptions[p.key] ?? []

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()} noValidate className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 ring-1 ring-foreground/5">
        {params.map((p) => (
          <FormField
            key={p.key}
            control={form.control}
            name={p.key}
            render={({ field }) => (
              <FormItem className="w-full space-y-1.5 sm:w-auto sm:min-w-[12rem]">
                {p.type !== "boolean" && (
                  <FormLabel className="text-xs text-muted-foreground">
                    {p.label}
                    {p.required && <span className="text-destructive"> *</span>}
                  </FormLabel>
                )}
                {p.type === "date" && (
                  <FormControl>
                    <DatePicker value={(field.value as string) || ""} onChange={(v) => field.onChange(v)} />
                  </FormControl>
                )}
                {p.type === "dateRange" && (
                  <FormControl>
                    <DateRangePicker
                      value={{ from: parseDateKey((field.value as { from: string })?.from), to: parseDateKey((field.value as { to: string })?.to) }}
                      onChange={(range) => field.onChange({ from: range?.from ? toDateKey(range.from) : "", to: range?.to ? toDateKey(range.to) : "" })}
                    />
                  </FormControl>
                )}
                {p.type === "select" && (
                  <FormControl>
                    <SearchableSelect value={(field.value as string) || ""} onChange={field.onChange} placeholder="Select…" options={options(p)} />
                  </FormControl>
                )}
                {p.type === "multiSelect" && <MultiSelect label={p.label} options={options(p)} value={(field.value as string[]) ?? []} onChange={field.onChange} />}
                {p.type === "boolean" && (
                  <label className="flex cursor-pointer items-center gap-2 pt-6 text-sm">
                    <Checkbox checked={!!field.value} onCheckedChange={(on) => field.onChange(!!on)} />
                    {p.label}
                  </label>
                )}
                {p.help && p.type !== "boolean" && <FormDescription className="text-xs">{p.help}</FormDescription>}
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        ))}
        {busy && <span className="ml-auto self-end pb-2 text-xs text-muted-foreground" role="status">Updating…</span>}
      </form>
    </Form>
  )
}

function MultiSelect({ label, options, value, onChange }: { label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const summary = value.length === 0 ? `All ${label.toLowerCase()}` : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? "1 selected") : `${value.length} selected`
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="outline" className="w-full justify-between gap-2 font-normal sm:min-w-[12rem]" />}>
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">No options.</p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                <Checkbox checked={value.includes(o.value)} onCheckedChange={(on) => onChange(on ? [...value, o.value] : value.filter((x) => x !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
        )}
        {value.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
