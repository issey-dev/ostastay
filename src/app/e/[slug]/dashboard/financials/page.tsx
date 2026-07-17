import { redirect } from "next/navigation"

export default async function FinancialsRedirectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/e/${slug}/dashboard/controls`)
}
