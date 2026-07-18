"use client"

import { useEffect, useState, use } from "react"
import ProfileForm from "@/components/profiles/ProfileForm"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { UserX } from "lucide-react"

export default function EditProfilePage({ params }: { params: Promise<{ upid: string }> }) {
  const { upid } = use(params)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/profiles/${upid}`)
      .then(res => res.json())
      .then(data => {
        // Transform the nested relations back to flat form structure for the initial data
        setProfile({
          ...data,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth).toISOString().split('T')[0] : "",
          anniversaryDate: data.anniversaryDate ? new Date(data.anniversaryDate).toISOString().split('T')[0] : "",
          mobile: data.contacts?.[0]?.mobile || "",
          email: data.contacts?.[0]?.email || "",
          address: data.contacts?.[0]?.address || "",
          country: data.contacts?.[0]?.country || "",
          documentType: data.documents?.[0]?.documentType || "",
          documentNumber: data.documents?.[0]?.documentNumber || "",
          issuingCountry: data.documents?.[0]?.issuingCountry || "",
          expiryDate: data.documents?.[0]?.expiryDate ? new Date(data.documents[0].expiryDate).toISOString().split('T')[0] : ""
        })
      })
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
