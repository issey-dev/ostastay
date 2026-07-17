"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import ProfileForm from "@/components/profiles/ProfileForm"

function ProfileFormWrapper() {
  const searchParams = useSearchParams()
  const type = searchParams.get("type") || "GUEST"
  return <ProfileForm defaultType={type} />
}

export default function NewProfilePage() {
  return (
    <div className="container mx-auto p-4 md:p-8">
      <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
        <ProfileFormWrapper />
      </Suspense>
    </div>
  )
}
