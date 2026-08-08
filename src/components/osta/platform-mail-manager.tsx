"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/lib/toast"

// The platform's OWN mail sender — what Uppsolut Stay uses to email client enterprises
// (handover credentials) and the ops mailbox (channel-manager alerts). Distinct from a
// tenant's SMTP under Controls → Reports → SMTP / SFTP, which sends a hotel's guest mail
// from the hotel's own domain.
//
// READ-ONLY on purpose, matching /api/osta/smtp: this is deployment configuration held in
// the container's environment. Showing it here answers "is platform mail actually working
// right now", which is the question an operator has — being able to rewrite the platform's
// sending identity from a web form is not something worth adding to answer it.

type PlatformSmtp = {
  configured: boolean
  host: string | null
  port: number | null
  username: string | null
  fromAddress: string | null
  fromName: string | null
  useTls: boolean | null
  alertRecipients: string[]
  appUrl: string
}

type TestResult = { ok: boolean; stage: "connect" | "send"; error?: string; sentTo?: string | null }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

export function PlatformMailManager() {
  const [smtp, setSmtp] = useState<PlatformSmtp | null>(null)
  const [loading, setLoading] = useState(true)
  const [testTo, setTestTo] = useState("")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  useEffect(() => {
    fetch("/api/osta/smtp")
      .then((res) => res.json())
      .then((data) => setSmtp(data))
      .finally(() => setLoading(false))
  }, [])

  const runTest = async (withSend: boolean) => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/osta/smtp", {
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

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Platform email
          {smtp?.configured ? (
            <Badge variant="outline" className="bg-success-muted text-success border-success/30">Configured</Badge>
          ) : (
            <Badge variant="outline" className="bg-warning-muted text-warning border-warning/40">Not configured</Badge>
          )}
        </CardTitle>
        <CardDescription>
          The sender Uppsolut Stay uses for enterprise handover credentials and channel-manager alerts. Set in the
          deployment environment (<code className="font-mono text-xs">PLATFORM_SMTP_*</code>) and shown here read-only —
          changing it means changing the environment and restarting. A property&apos;s own guest mail is configured
          separately, by the tenant, under their Controls &rarr; Reports &rarr; SMTP / SFTP.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {smtp?.configured ? (
          <div>
            <Row label="Host" value={<code className="font-mono text-xs">{smtp.host}:{smtp.port}</code>} />
            <Row label="Username" value={<code className="font-mono text-xs">{smtp.username}</code>} />
            <Row
              label="From"
              value={<code className="font-mono text-xs">{smtp.fromName ? `${smtp.fromName} <${smtp.fromAddress}>` : smtp.fromAddress}</code>}
            />
            <Row label="STARTTLS" value={smtp.useTls ? "Required" : "Off"} />
            <Row
              label="Alert recipients"
              value={
                smtp.alertRecipients.length > 0 ? (
                  <code className="font-mono text-xs">{smtp.alertRecipients.join(", ")}</code>
                ) : (
                  <span className="text-warning">None — channel alerts are off</span>
                )
              }
            />
            <Row label="Links point at" value={<code className="font-mono text-xs">{smtp.appUrl}</code>} />
          </div>
        ) : (
          <div className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm text-warning">
            Platform email is not configured. Enterprise handover credentials will not be emailed — they are still
            shown on screen for manual handover — and channel-manager alerts will not be sent. Set
            <code className="mx-1 font-mono text-xs">PLATFORM_SMTP_HOST</code>,
            <code className="mx-1 font-mono text-xs">PLATFORM_SMTP_USERNAME</code>,
            <code className="mx-1 font-mono text-xs">PLATFORM_SMTP_PASSWORD</code> and
            <code className="mx-1 font-mono text-xs">PLATFORM_SMTP_FROM_ADDRESS</code> in the environment.
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-5">
          <div className="space-y-1">
            <Label className="text-sm">Test the sender</Label>
            <p className="text-xs text-muted-foreground">
              Test connection only signs in. Sending a real message is the only way to prove the provider accepts the
              From address and that mail arrives — a relay will authenticate happily and still reject the envelope.
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
            <Button type="button" variant="outline" disabled={testing || !smtp?.configured} onClick={() => void runTest(false)}>
              Test connection
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={testing || !smtp?.configured || !testTo.trim()}
              onClick={() => void runTest(true)}
            >
              Send test email
            </Button>
          </div>
          {testing && <p className="text-sm text-muted-foreground">Testing…</p>}
          {testResult && !testing && (
            testResult.ok ? (
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
            )
          )}
        </div>
      </CardContent>
    </Card>
  )
}
