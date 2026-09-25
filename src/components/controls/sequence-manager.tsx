"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Sequence = {
  sequenceType: string
  currentValue: number
  updatedAt: string | null
  /** Highest number already on an issued document — the counter can't go below it. */
  highestIssued: number | null
  /** Guest Registration No once the Green Tax register holds numbers this year. */
  locked: boolean
}

const SEQUENCE_LABELS: Record<string, string> = {
  REGISTRATION_NO: "Reservation No (confirmation)",
  PROFORMA_FOLIO: "Proforma Folio",
  TAX_INVOICE: "Tax Invoice",
  RECEIPT_NO: "Receipt No",
  CHECK_NO: "Check number",
  GUEST_REG_NO: "Guest Registration No (Green Tax, resets yearly)",
}
const SEQUENCE_TYPES = Object.keys(SEQUENCE_LABELS)

// The counter holds the LAST number issued; the next document gets currentValue + 1.
// The floor mirrors the API guard (src/lib/sequence-guard.ts) so the user sees why a
// value is refused before saving — the API re-checks against the live documents.
function sequenceSchema(highestIssued: number | null) {
  const floor = highestIssued ?? 0
  return z.object({
    currentValue: z.coerce
      .number({ message: "Enter a number" })
      .int("Whole numbers only")
      .nonnegative("Can't be negative")
      .max(2_000_000_000, "That number is too large")
      .refine((v) => v >= floor, {
        message: `Number ${floor} has already been issued — use ${floor} or higher so no number is issued twice.`,
      }),
  })
}

function EditSequenceForm({
  propertyId,
  seq,
  compact,
  onCancel,
  onSaved,
}: {
  propertyId: string
  seq: Sequence
  compact?: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const schema = useMemo(() => sequenceSchema(seq.highestIssued), [seq.highestIssued])
  type FormInput = z.input<typeof schema>
  type FormValues = z.output<typeof schema>
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { currentValue: seq.currentValue },
  })

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    const res = await fetch("/api/settings/sequences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, sequenceType: seq.sequenceType, currentValue: values.currentValue }),
    })
    if (res.ok) {
      onSaved()
      return
    }
    const body = await res.json().catch(() => null)
    setServerError(typeof body?.error === "string" ? body.error : "Couldn't save the sequence.")
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className={compact ? "space-y-3" : "flex flex-wrap items-start justify-end gap-2"}>
        <FormField
          control={form.control}
          name="currentValue"
          render={({ field }) => (
            <FormItem className={compact ? "" : "w-full max-w-xs text-left"}>
              <FormControl>
                <Input
                  type="number"
                  min={seq.highestIssued ?? 0}
                  step={1}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value === undefined || field.value === null ? "" : String(field.value)}
                  onChange={(e) => field.onChange(e.target.value)}
                  className={compact ? "h-9" : "h-8"}
                  autoFocus
                  aria-label="Current sequence"
                />
              </FormControl>
              <FormMessage />
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            </FormItem>
          )}
        />
        <div className={compact ? "flex gap-2" : "flex gap-2"}>
          <Button type="button" variant="outline" size={compact ? "default" : "sm"} className={compact ? "h-9 flex-1" : ""} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size={compact ? "default" : "sm"}
            className={compact ? "h-9 flex-1" : ""}
            disabled={!form.formState.isValid || form.formState.isSubmitting}
          >
            Save
          </Button>
        </div>
      </form>
    </Form>
  )
}

const GREEN_TAX_LOCKED_NOTE =
  "Numbers have been given this year — correct them on the Green Tax register (Hub › Green Tax)."

export function SequenceManager({ propertyId }: { propertyId: string }) {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [editingType, setEditingType] = useState<string | null>(null)

  const fetchSequences = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/settings/sequences?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSequences(data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchSequences() }, [fetchSequences])

  const seqFor = (sequenceType: string): Sequence =>
    sequences.find((s) => s.sequenceType === sequenceType) ?? { sequenceType, currentValue: 0, updatedAt: null, highestIssued: null, locked: false }

  const onSaved = () => {
    setEditingType(null)
    fetchSequences()
  }

  const note = (seq: Sequence) =>
    seq.locked
      ? GREEN_TAX_LOCKED_NOTE
      : seq.highestIssued
        ? `Highest issued: ${seq.highestIssued} · next: ${seq.currentValue + 1}`
        : `Next: ${seq.currentValue + 1}`

  return (
    <div className="space-y-4">
      {propertyId && (
        <>
          {/* Phone view — one card per document type: label, current value (or its edit
              field), and the same actions full-width. */}
          <MobileCardList>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            ) : (
              SEQUENCE_TYPES.map((sequenceType) => {
                const seq = seqFor(sequenceType)
                const isEditing = editingType === sequenceType
                return isEditing ? (
                  <MobileCard key={sequenceType} title={SEQUENCE_LABELS[sequenceType]}>
                    <EditSequenceForm propertyId={propertyId} seq={seq} compact onCancel={() => setEditingType(null)} onSaved={onSaved} />
                  </MobileCard>
                ) : (
                  <MobileCard
                    key={sequenceType}
                    title={SEQUENCE_LABELS[sequenceType]}
                    meta={[{ label: "Current sequence", value: <span className="tabular-nums">{seq.currentValue}</span>, wide: true }]}
                    actions={
                      <Button variant="outline" className="h-9 w-full" disabled={seq.locked} onClick={() => setEditingType(sequenceType)}>
                        Start from new sequence
                      </Button>
                    }
                  >
                    <p className="text-xs text-muted-foreground">{note(seq)}</p>
                  </MobileCard>
                )
              })
            )}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Current sequence</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : (
                SEQUENCE_TYPES.map((sequenceType) => {
                  const seq = seqFor(sequenceType)
                  const isEditing = editingType === sequenceType
                  return (
                    <TableRow key={sequenceType}>
                      <TableCell className="font-medium">{SEQUENCE_LABELS[sequenceType]}</TableCell>
                      {isEditing ? (
                        <TableCell colSpan={2}>
                          <EditSequenceForm propertyId={propertyId} seq={seq} onCancel={() => setEditingType(null)} onSaved={onSaved} />
                        </TableCell>
                      ) : (
                        <>
                          <TableCell>
                            <span className="tabular-nums">{seq.currentValue}</span>
                            <p className="text-xs text-muted-foreground">{note(seq)}</p>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" disabled={seq.locked} onClick={() => setEditingType(sequenceType)}>
                              Start from new sequence
                            </Button>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          </div>
        </>
      )}
    </div>
  )
}
