"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Save } from "@/components/icons"
import { InfoHint } from "@/components/ui/info-hint"
import { toast } from "@/lib/toast"

type SmtpSftpForm = {
  smtpHost: string
  smtpPort: string
  smtpUsername: string
  smtpPassword: string
  smtpFromAddress: string
  smtpUseTls: boolean
  sftpHost: string
  sftpPort: string
  sftpUsername: string
  sftpPassword: string
  sftpRemotePath: string
}

const EMPTY: SmtpSftpForm = {
  smtpHost: "", smtpPort: "", smtpUsername: "", smtpPassword: "", smtpFromAddress: "", smtpUseTls: true,
  sftpHost: "", sftpPort: "", sftpUsername: "", sftpPassword: "", sftpRemotePath: "",
}

// Controls → Reports → SMTP / SFTP.
//
// SMTP here is the enterprise's OWN sending account, used for GUEST-facing mail —
// confirmation letters, eRegistration links, debtor statements. It is separate from the
// platform's sender, which is what Uppsolut Stay uses to mail this enterprise itself
// (handover credentials, channel alerts) and is configured in the environment, not here.
// See the two-sender note in src/lib/mailer.ts.
//
// SFTP remains scaffold — those fields save but nothing transfers files yet.
type TestResult = {
  ok: boolean
  stage: "connect" | "send"
  /** Which account the message actually went through — the enterprise's own, or Uppsolut's. */
  sender?: "TENANT" | "PLATFORM"
  error?: string
  sentTo?: string | null
}

export function SmtpSftpManager() {
  const [form, setForm] = useState<SmtpSftpForm>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [testTo, setTestTo] = useState("")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  useEffect(() => {
    fetch("/api/tenant-settings")
      .then((res) => res.json())
      .then((data) => {
        if (!data) return
        setForm({
          smtpHost: data.smtpHost ?? "",
          smtpPort: data.smtpPort?.toString() ?? "",
          smtpUsername: data.smtpUsername ?? "",
          smtpPassword: data.smtpPassword ?? "",
          smtpFromAddress: data.smtpFromAddress ?? "",
          smtpUseTls: data.smtpUseTls ?? true,
          sftpHost: data.sftpHost ?? "",
          sftpPort: data.sftpPort?.toString() ?? "",
          sftpUsername: data.sftpUsername ?? "",
          sftpPassword: data.sftpPassword ?? "",
          sftpRemotePath: data.sftpRemotePath ?? "",
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSavedMsg(false)
    try {
      await fetch("/api/tenant-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          smtpPort: form.smtpPort ? parseInt(form.smtpPort) : null,
          sftpPort: form.sftpPort ? parseInt(form.sftpPort) : null,
        }),
      })
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 3000)
      // Saving changes what a test would exercise, so a previous verdict is now stale.
      setTestResult(null)
    } finally {
      setSaving(false)
    }
  }

  // Tests the SAVED settings, not what is currently on screen — the stored password never
  // comes back to the browser (GET returns a mask), so there is nothing to test with here.
  const runTest = async (withSend: boolean) => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/tenant-settings/smtp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSend ? { to: testTo.trim() } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "The test could not be run")
        return
      }
      setTestResult(data)
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="space-y-3 py-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground uppercase tracking-wider">
            SMTP (Outgoing Email)
            <InfoHint label="SMTP (Outgoing Email)">Your own sending account, used for guest mail — Confirmation Letters, eRegistration links and debtor statements. Configure it before using any &quot;Email to Guest&quot; button. Save your changes, then use Test connection below to check them.</InfoHint>
          </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Host</Label>
            <Input placeholder="smtp.example.com" value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Port</Label>
            <Input type="number" placeholder="587" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={form.smtpUsername} onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input type="password" value={form.smtpPassword} onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>From Address</Label>
            <Input type="email" placeholder="no-reply@example.com" value={form.smtpFromAddress} onChange={(e) => setForm({ ...form, smtpFromAddress: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={form.smtpUseTls} onCheckedChange={(checked) => setForm({ ...form, smtpUseTls: !!checked })} />
            <Label>Use TLS</Label>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-sm">Test these settings</Label>
            <p className="text-xs text-muted-foreground">
              Tests the <strong>saved</strong> settings, so save first. Test connection only signs in to the mail
              server; sending a real message is the only way to prove your provider accepts the From address and
              that mail actually arrives.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="email"
              className="w-full sm:w-72"
              placeholder="you@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button type="button" variant="outline" disabled={testing} onClick={() => void runTest(false)}>
              Test connection
            </Button>
            <Button type="button" variant="outline" disabled={testing || !testTo.trim()} onClick={() => void runTest(true)}>
              Send test email
            </Button>
          </div>
          {testing && <p className="text-sm text-muted-foreground">Testing…</p>}
          {testResult && !testing && (
            <div className="space-y-1">
              {testResult.ok ? (
                <p className="text-sm text-success">
                  {testResult.stage === "send"
                    ? `Test email sent to ${testResult.sentTo}. Check the inbox — and the spam folder.`
                    : "Connected and authenticated successfully."}
                </p>
              ) : (
                <p className="text-sm text-destructive">
                  {testResult.stage === "send" ? "Connected, but the message was rejected: " : "Could not connect: "}
                  {testResult.error}
                </p>
              )}
              {/* Which account was actually used. Worth stating plainly: an enterprise on the
                  Uppsolut Mail Service has working email with these fields left blank, and
                  without this the panel would look broken to them. */}
              {testResult.sender === "PLATFORM" && (
                <p className="text-xs text-muted-foreground">
                  Sent through the <strong>Uppsolut Mail Service</strong> — your enterprise has no SMTP of its own
                  configured, so mail goes out through Uppsolut&apos;s (a billed service). Fill in the fields above to
                  send from your own domain instead; your own settings always take priority.
                </p>
              )}
              {testResult.sender === "TENANT" && (
                <p className="text-xs text-muted-foreground">Sent through your own SMTP.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-8">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground uppercase tracking-wider">
            SFTP (File Transfer)
            <InfoHint label="SFTP (File Transfer)">Not yet wired to any actual transfer — saved for when a file-export feature is built.</InfoHint>
          </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Host</Label>
            <Input placeholder="sftp.example.com" value={form.sftpHost} onChange={(e) => setForm({ ...form, sftpHost: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Port</Label>
            <Input type="number" placeholder="22" value={form.sftpPort} onChange={(e) => setForm({ ...form, sftpPort: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={form.sftpUsername} onChange={(e) => setForm({ ...form, sftpUsername: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input type="password" value={form.sftpPassword} onChange={(e) => setForm({ ...form, sftpPassword: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Remote Path</Label>
            <Input placeholder="/exports" value={form.sftpRemotePath} onChange={(e) => setForm({ ...form, sftpRemotePath: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 justify-end pt-4 border-t">
        {savedMsg && <span className="text-sm text-success">Saved</span>}
        <Button type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </form>
  )
}
