"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Loader2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { announcementSchema, type AnnouncementRow } from "@/lib/notifications/announcements-shared"
import { ago } from "@/components/notifications/format"
import { toast } from "@/lib/toast"

// Hub › Announcements: write a message to everyone in the enterprise or to one property, and
// see what has been sent and how many people have read it. Form: Zod + React Hook Form,
// inline validation as you type (APP STANDARD 001).

type FormValues = { title: string; body?: string; audience: string }

export function AnnouncementsManager({ properties, canSend }: { properties: { id: string; name: string }[]; canSend: boolean }) {
  const [history, setHistory] = useState<AnnouncementRow[] | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(announcementSchema),
    mode: "onChange",
    defaultValues: { title: "", body: "", audience: "ALL" },
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements", { cache: "no-store" })
      if (res.ok) setHistory(((await res.json()) as { announcements: AnnouncementRow[] }).announcements)
      else setHistory([])
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    // Initial load of the sent list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    const res = await fetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) })
    const body = (await res.json().catch(() => null)) as { error?: string; recipients?: number; id?: string | null } | null
    if (!res.ok) {
      setServerError(body?.error ?? "The announcement could not be sent.")
      return
    }
    if (!body?.id) {
      setServerError("Nobody is there to receive it. Check the property has active people.")
      return
    }
    toast.success(`Sent to ${body.recipients} ${body.recipients === 1 ? "person" : "people"}`)
    form.reset({ title: "", body: "", audience: values.audience })
    void load()
  }

  const options = [{ label: "Everyone, all properties", value: "ALL" }, ...properties.map((p) => ({ label: p.name, value: p.id }))]
  const bodyLength = (form.watch("body") ?? "").length

  return (
    <div className="space-y-8">
      {canSend ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-5">
            <FormField
              control={form.control}
              name="audience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Who is it for</FormLabel>
                  <FormControl>
                    <SearchableSelect value={field.value} onChange={field.onChange} options={options} placeholder="Choose who it is for" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Water off on Sunday 06:00 to 09:00" maxLength={80} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={4} maxLength={500} placeholder="Anything people need to know or do." />
                  </FormControl>
                  <FormDescription>{bodyLength}/500. People see it in the bell and on their phone, so keep it short and leave out guest names and amounts.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
            <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isValid}>
              {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send announcement
            </Button>
          </form>
        </Form>
      ) : (
        <p className="text-sm text-muted-foreground">You can see what has been sent. Sending needs permission to change enterprise setup.</p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Sent</h2>
        {!history ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {history.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                {a.body && <p className="text-sm text-muted-foreground">{a.body}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.propertyName ?? "Everyone"} · {ago(a.createdAt)} · read by {a.read} of {a.recipients}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
