"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Save } from "@/components/icons"

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

// Scaffold only — these fields save correctly but nothing in the app actually sends
// email or transfers files yet. Build the real capability first, then wire it to these
// settings, rather than the other way around.
export function SmtpSftpManager() {
  const [form, setForm] = useState<SmtpSftpForm>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

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
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading...</div>

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">SMTP (Outgoing Email)</h3>
        <p className="text-xs text-muted-foreground">Used to send guest Confirmation Letters. Configure these before using the "Email to Guest" button on a reservation's Confirmation Letter.</p>
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
      </div>

      <div className="space-y-4 border-t border-border pt-8">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">SFTP (File Transfer)</h3>
        <p className="text-xs text-muted-foreground">Not yet wired to any actual transfer — saved for when a file-export feature is built.</p>
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
