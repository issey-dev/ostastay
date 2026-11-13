"use client"

import { useEffect, useState } from "react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { INPUT_EMAIL } from "@/lib/input-presets"

// "Search, and create if it is not there" (Agent Portal plan A-21a). A short dialog with only
// the fields a profile type needs, opened from a picker's "Create “…”" row: it saves the
// profile and hands it back so the picker selects it, without leaving the booking.

export type QuickProfileType = "GUEST" | "COMPANY" | "TRAVEL_AGENT" | "SOURCE"

const TITLES: Record<QuickProfileType, string> = {
  GUEST: "New guest",
  COMPANY: "New company",
  TRAVEL_AGENT: "New travel agent",
  SOURCE: "New source",
}

const schema = z
  .object({
    profileType: z.enum(["GUEST", "COMPANY", "TRAVEL_AGENT", "SOURCE"]),
    firstName: z.string().trim().max(80),
    lastName: z.string().trim().max(80),
    companyName: z.string().trim().max(120),
    email: z.string().trim().email("Enter a valid email").or(z.literal("")),
    mobile: z.string().trim().regex(/^[0-9+\-() \s]*$/, "Digits, spaces, + - ( ) only"),
    commissionRate: z
      .string()
      .trim()
      .refine((v) => v === "" || (!isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100), "0 to 100"),
  })
  .superRefine((v, ctx) => {
    if (v.profileType === "GUEST") {
      if (!v.firstName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["firstName"], message: "First name is required" })
      if (/\d/.test(v.firstName + v.lastName)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["firstName"], message: "Names cannot contain numbers" })
    } else if (!v.companyName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Name is required" })
    }
  })

type Values = z.infer<typeof schema>

export type CreatedProfile = { upid: string; profileType: string; firstName: string; lastName: string | null; companyName: string | null }

export function QuickProfileDialog({
  open,
  type,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean
  type: QuickProfileType
  initialName: string
  onClose: () => void
  onCreated: (p: CreatedProfile) => void
}) {
  const [saving, setSaving] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { profileType: type, firstName: "", lastName: "", companyName: "", email: "", mobile: "", commissionRate: "" },
  })

  useEffect(() => {
    if (!open) return
    const parts = initialName.trim().split(/\s+/)
    form.reset({
      profileType: type,
      firstName: type === "GUEST" ? (parts[0] ?? "") : "",
      lastName: type === "GUEST" ? parts.slice(1).join(" ") : "",
      companyName: type === "GUEST" ? "" : initialName.trim(),
      email: "",
      mobile: "",
      commissionRate: "",
    })
  }, [open, type, initialName, form])

  const submit = form.handleSubmit(async (v) => {
    setSaving(true)
    try {
      const communications = [
        ...(v.email ? [{ type: "EMAIL", value: v.email, isPrimary: true }] : []),
        ...(v.mobile ? [{ type: "MOBILE", value: v.mobile, isPrimary: !v.email }] : []),
      ]
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileType: v.profileType,
          firstName: v.profileType === "GUEST" ? v.firstName : v.companyName,
          lastName: v.profileType === "GUEST" ? v.lastName || null : null,
          companyName: v.profileType === "GUEST" ? null : v.companyName,
          commissionRate: v.commissionRate === "" ? null : v.commissionRate,
          ...(communications.length ? { communications } : {}),
        }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't create the profile. Try again."))
        return
      }
      const created = (await res.json()) as CreatedProfile
      toast.success(`${TITLES[type].replace("New ", "")} created`)
      onCreated(created)
      onClose()
    } finally {
      setSaving(false)
    }
  })

  const err = form.formState.errors
  const isGuest = type === "GUEST"
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" mobile="sheet">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{TITLES[type]}</DialogTitle>
            <DialogDescription>The essentials only. Fill in the rest on the profile later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {isGuest ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="qp-first">First name</Label>
                  <Input id="qp-first" {...form.register("firstName")} />
                  {err.firstName && <p className="text-xs text-destructive">{err.firstName.message}</p>}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="qp-last">Last name</Label>
                  <Input id="qp-last" {...form.register("lastName")} />
                </div>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="qp-company">Name</Label>
                <Input id="qp-company" {...form.register("companyName")} />
                {err.companyName && <p className="text-xs text-destructive">{err.companyName.message}</p>}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="qp-email">Email</Label>
              <Input id="qp-email" {...INPUT_EMAIL} {...form.register("email")} />
              {err.email && <p className="text-xs text-destructive">{err.email.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="qp-mobile">Mobile</Label>
              <Input id="qp-mobile" inputMode="tel" {...form.register("mobile")} />
              {err.mobile && <p className="text-xs text-destructive">{err.mobile.message}</p>}
            </div>
            {(type === "TRAVEL_AGENT" || type === "SOURCE") && (
              <div className="grid gap-1.5">
                <Label htmlFor="qp-comm">Commission %</Label>
                <Input id="qp-comm" inputMode="decimal" placeholder="e.g. 10" {...form.register("commissionRate")} />
                {err.commissionRate && <p className="text-xs text-destructive">{err.commissionRate.message}</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
