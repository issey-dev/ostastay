import { prisma } from "@/lib/db"
import { LoginForm } from "@/components/auth/login-form"

export default async function EnterpriseLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const enterprise = await prisma.enterprise.findUnique({ where: { slug: slug.toLowerCase() } })

  if (!enterprise) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Enterprise not found</h1>
          <p className="text-muted-foreground mt-2">
            The link &quot;{slug}&quot; doesn&apos;t match any enterprise. Double-check the URL your
            organization gave you, or sign in at <a href="/login" className="text-primary hover:underline">/login</a>.
          </p>
        </div>
      </div>
    )
  }

  return <LoginForm enterpriseSlug={enterprise.slug} enterpriseName={enterprise.name} />
}
