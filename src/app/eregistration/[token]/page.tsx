import { EregistrationClient } from "./eregistration-client"

export default async function EregistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <EregistrationClient token={token} />
}
