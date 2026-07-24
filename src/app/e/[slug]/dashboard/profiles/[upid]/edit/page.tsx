"use client"

import { useEffect, useState, use } from "react"
import ProfileForm from "@/components/profiles/ProfileForm"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { UserX } from "@/components/icons"

export default function EditProfilePage({ params }: { params: Promise<{ upid: string }> }) {
  const { upid } = use(params)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // ProfileForm reads scalar fields straight off this + manages Communications/
    // Address/Identification/Attachments/Notes/Preferences via their own dedicated
    // endpoints (see .agents/docs/PROFILES_REDESIGN_PLAN.md) — no flattening needed.
    fetch(`/api/profiles/${upid}`)
      .then(res => res.json())
      .then(data => setProfile(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [upid])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!profile) {
    return <EmptyState icon={UserX} title="Profile not found" className="py-24" />
  }

  return (
    <div className="container mx-auto p-4 md:p-8 pt-6">
      <ProfileForm initialData={profile} upid={upid} />
    </div>
  )
}
