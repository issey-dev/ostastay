"use client"

import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"

// The block's profiles (owner, 2026-11-13): its Travel Agent or Company, its Source, and the
// account its master bill goes to. The first two are carried by every reservation in the
// block and are locked there. Bill to lists credit accounts of all three kinds.

export type BlockProfile = {
  upid: string
  firstName: string
  lastName?: string | null
  companyName?: string | null
  profileType: string
  isCreditAccount?: boolean
}

export type BlockProfileValues = { travelAgentId: string; sourceProfileId: string; payeeProfileId: string }

const TYPE_LABEL: Record<string, string> = { TRAVEL_AGENT: "Travel agent", COMPANY: "Company", SOURCE: "Source" }
export const profileName = (p: Pick<BlockProfile, "firstName" | "lastName" | "companyName">) =>
  p.companyName || `${p.firstName} ${p.lastName ?? ""}`.trim()

export function BlockProfileFields({
  profiles,
  value,
  onChange,
  showSource = true,
}: {
  profiles: BlockProfile[]
  value: BlockProfileValues
  onChange: (next: BlockProfileValues) => void
  /** Hidden where the Source is set elsewhere (a slot request). */
  showSource?: boolean
}) {
  const agents = profiles.filter((p) => p.profileType === "TRAVEL_AGENT" || p.profileType === "COMPANY")
  const sources = profiles.filter((p) => p.profileType === "SOURCE")
  const accounts = profiles.filter((p) => p.isCreditAccount && TYPE_LABEL[p.profileType])
  const byId = new Map(profiles.map((p) => [p.upid, p]))

  // Picking a profile that is a credit account fills Bill to when it is still empty.
  const pick = (field: "travelAgentId" | "sourceProfileId", id: string) => {
    const next = { ...value, [field]: id }
    const p = byId.get(id)
    if (value.payeeProfileId === "none" && p?.isCreditAccount) next.payeeProfileId = id
    onChange(next)
  }
  // Attached, but not yet a credit account: say why it is missing from Bill to.
  const notCredit = [value.travelAgentId, value.sourceProfileId]
    .map((id) => byId.get(id))
    .filter((p): p is BlockProfile => !!p && !p.isCreditAccount)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Travel agent / company</Label>
          <SearchableSelect
            value={value.travelAgentId}
            onChange={(v) => pick("travelAgentId", v ?? "none")}
            placeholder="None"
            options={[{ value: "none", label: "None" }, ...agents.map((p) => ({ value: p.upid, label: `${profileName(p)} · ${TYPE_LABEL[p.profileType]}` }))]}
          />
        </div>
        {showSource && (
          <div className="space-y-2">
            <Label>Source</Label>
            <SearchableSelect
              value={value.sourceProfileId}
              onChange={(v) => pick("sourceProfileId", v ?? "none")}
              placeholder="None"
              options={[{ value: "none", label: "None" }, ...sources.map((p) => ({ value: p.upid, label: profileName(p) }))]}
            />
          </div>
        )}
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">Every reservation in this block takes these profiles, and they can&rsquo;t be changed on the reservation.</p>
      <div className="space-y-2">
        <Label>Bill to account (City Ledger)</Label>
        <SearchableSelect
          value={value.payeeProfileId}
          onChange={(v) => onChange({ ...value, payeeProfileId: v ?? "none" })}
          placeholder="No account (bill direct)..."
          options={[
            { value: "none", label: "None (bill direct)" },
            ...accounts.map((p) => ({ value: p.upid, label: `${profileName(p)} · ${TYPE_LABEL[p.profileType]}` })),
          ]}
        />
        {notCredit.length > 0 ? (
          <p className="text-[11px] text-warning">
            {notCredit.map(profileName).join(" and ")} {notCredit.length === 1 ? "isn't a credit account" : "aren't credit accounts"} yet, so {notCredit.length === 1 ? "it can't" : "they can't"} be billed. Turn on <strong>Credit account</strong> on the profile.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">The master bill settles to this debtor account when closed. Travel agents, companies and sources that are credit accounts are listed.</p>
        )}
      </div>
    </>
  )
}
