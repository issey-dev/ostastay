"use client"

import { useEffect, useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { cn } from "@/lib/utils"
import { Download, FileSpreadsheet, FileText, FileType, Loader2, Check } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { DEFAULT_EXPORT_OPTIONS, exportOptionsSchema, type ExportOptions } from "@/lib/reports/export-options"

// "Download as" — one dialog for every file format, replacing the row of format buttons.
// The choices (delimiter, encoding, charts in the PDF …) are validated with the SAME Zod
// schema the server uses, and remembered per browser for next time.

export type DownloadFormat = "pdf" | "xlsx" | "txt" | "csv"

const formSchema = z.object({
  format: z.enum(["pdf", "xlsx", "txt", "csv"]),
  options: exportOptionsSchema,
})
type DownloadForm = { format: DownloadFormat; options: ExportOptions }

const FORMATS: { id: DownloadFormat; label: string; ext: string; blurb: string; icon: typeof FileText }[] = [
  { id: "pdf", label: "PDF", ext: "pdf", blurb: "A print-ready document", icon: FileText },
  { id: "xlsx", label: "Excel", ext: "xlsx", blurb: "A workbook you can edit and chart", icon: FileSpreadsheet },
  { id: "txt", label: "Delimited text", ext: "txt", blurb: "Tab, pipe or custom separated, for other systems", icon: FileType },
  { id: "csv", label: "CSV", ext: "csv", blurb: "Comma separated, opens in any spreadsheet", icon: FileType },
]

const STORE = "reports.download.v1"
const readStored = (): Partial<DownloadForm> => {
  try {
    const raw = window.localStorage.getItem(STORE)
    return raw ? (JSON.parse(raw) as Partial<DownloadForm>) : {}
  } catch {
    return {}
  }
}
const writeStored = (v: DownloadForm) => {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(v))
  } catch {
    /* private window / blocked storage — remembering is a convenience only */
  }
}

export function DownloadDialog({
  open,
  onOpenChange,
  reportKey,
  hasVisuals,
  busy,
  onDownload,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportKey: string
  hasVisuals: boolean
  busy: DownloadFormat | null
  onDownload: (format: DownloadFormat, options: ExportOptions) => Promise<boolean>
}) {
  const form = useForm<DownloadForm>({
    resolver: zodResolver(formSchema) as unknown as Resolver<DownloadForm>,
    mode: "onChange",
    defaultValues: { format: "pdf", options: DEFAULT_EXPORT_OPTIONS },
  })
  const [restored, setRestored] = useState(false)

  // Restore the last choice each time the dialog opens.
  useEffect(() => {
    if (!open) return
    const s = readStored()
    form.reset({
      format: s.format ?? "pdf",
      options: { ...DEFAULT_EXPORT_OPTIONS, ...(s.options ?? {}) },
    })
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const format = form.watch("format")
  const opts = form.watch("options")
  const ext = FORMATS.find((f) => f.id === format)!.ext
  const stem = reportKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  const today = new Date().toISOString().slice(0, 10)
  const textual = format === "txt" || format === "csv"

  const submit = form.handleSubmit(async (v) => {
    writeStored(v)
    const ok = await onDownload(v.format, v.options)
    if (ok) onOpenChange(false)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Download as</DialogTitle>
          <DialogDescription>Choose a file type. The file contains exactly what is on screen.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="format"
              render={({ field }) => (
                <FormItem>
                  <div role="radiogroup" aria-label="File type" className="grid grid-cols-2 gap-2">
                    {FORMATS.map((f) => {
                      const selected = field.value === f.id
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => field.onChange(f.id)}
                          className={cn(
                            "relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <f.icon className="h-4 w-4 text-muted-foreground" />
                            {f.label}
                            <span className="text-xs font-normal text-muted-foreground">.{f.ext}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">{f.blurb}</span>
                          {selected && <Check className="absolute top-2 right-2 h-4 w-4 text-primary" />}
                        </button>
                      )
                    })}
                  </div>
                </FormItem>
              )}
            />

            {/* Options for the chosen type */}
            <div className="space-y-3 rounded-xl bg-muted/40 p-3">
              {format === "pdf" && (
                <>
                  <FormField
                    control={form.control}
                    name="options.orientation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Page orientation</FormLabel>
                        <SelectField value={field.value} onChange={field.onChange} items={[["auto", "Automatic (by number of columns)"], ["portrait", "Portrait"], ["landscape", "Landscape"]]} />
                      </FormItem>
                    )}
                  />
                  {hasVisuals && (
                    <SwitchField form={form} name="options.includeVisuals" label="Include figures and charts" help="Turn off for a compact, table-only document." />
                  )}
                </>
              )}

              {format === "xlsx" && (
                hasVisuals ? (
                  <SwitchField form={form} name="options.includeSummarySheet" label="Add a Summary sheet" help="Key figures and the numbers behind each chart, on their own sheet." />
                ) : (
                  <p className="text-sm text-muted-foreground">A single formatted sheet with this report&rsquo;s rows and totals.</p>
                )
              )}

              {textual && (
                <>
                  <FormField
                    control={form.control}
                    name="options.layout"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Layout</FormLabel>
                        <SelectField
                          value={field.value}
                          onChange={field.onChange}
                          items={[["data", "Data only — one header row, raw values (for import)"], ["presentation", "As printed — title, group headings, subtotals"]]}
                        />
                      </FormItem>
                    )}
                  />

                  {format === "txt" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="options.delimiter"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Delimiter</FormLabel>
                            <SelectField value={field.value} onChange={field.onChange} items={[["tab", "Tab"], ["pipe", "Pipe ( | )"], ["semicolon", "Semicolon ( ; )"], ["comma", "Comma ( , )"], ["custom", "Custom character…"]]} />
                          </FormItem>
                        )}
                      />
                      {opts.delimiter === "custom" && (
                        <FormField
                          control={form.control}
                          name="options.customDelimiter"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Character</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} maxLength={1} className="w-20 text-center font-mono" placeholder="~" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="options.qualifier"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Text qualifier</FormLabel>
                          <SelectField value={field.value} onChange={field.onChange} items={[["needed", "Quote when needed"], ["always", "Quote every value"], ["none", "None"]]} />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="options.encoding"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Encoding</FormLabel>
                          <SelectField value={field.value} onChange={field.onChange} items={[["utf8", "UTF-8"], ["utf8bom", "UTF-8 with BOM (Excel)"], ["windows1252", "Windows-1252 (legacy)"]]} />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="options.lineEnding"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Line ending</FormLabel>
                          <SelectField value={field.value} onChange={field.onChange} items={[["crlf", "Windows (CRLF)"], ["lf", "Unix (LF)"]]} />
                        </FormItem>
                      )}
                    />
                  </div>
                  {opts.layout === "data" && <SwitchField form={form} name="options.header" label="Include the header row" />}
                </>
              )}
            </div>

            <p className="truncate text-xs text-muted-foreground">
              File name: <span className="font-mono text-foreground">{stem}-{today}.{ext}</span>
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={!!busy || !form.formState.isValid || !restored}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {busy ? "Preparing…" : "Download"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function SelectField({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue>{items.find(([v]) => v === value)?.[1] ?? value}</SelectValue>
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SwitchField({
  form,
  name,
  label,
  help,
}: {
  form: ReturnType<typeof useForm<DownloadForm>>
  name: "options.includeVisuals" | "options.includeSummarySheet" | "options.header"
  label: string
  help?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start justify-between gap-4 space-y-0">
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            {help && <FormDescription className="text-xs">{help}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}
