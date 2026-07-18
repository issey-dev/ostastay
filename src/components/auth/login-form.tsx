"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { KeyRound, Hotel } from "lucide-react"

// Shared by the generic /login (asks for an Enterprise Code) and each enterprise's own
// dedicated /e/{slug}/login (the code is baked in from the URL, hidden from the form).
// A wrong code, wrong email, and wrong password all surface the same generic error —
// see /api/auth/login's GENERIC_ERROR.
export function LoginForm({ enterpriseSlug, enterpriseName, showDevSeed }: {
  enterpriseSlug?: string
  enterpriseName?: string
  showDevSeed?: boolean
}) {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, enterpriseSlug: enterpriseSlug ?? code }),
      })

      const data = await res.json()

      if (res.ok) {
        router.push(`/e/${data.enterpriseSlug}/dashboard`)
        router.refresh()
      } else {
        setError(data.error || "Login failed")
      }
    } catch (err) {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSeed = async () => {
    const res = await fetch("/api/auth/seed", { method: "POST" })
    if (res.ok) {
      alert("Seed complete! Use admin@hotel.com and password123 (Enterprise Code: demo)")
    }
  }

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-none bg-primary text-primary-foreground mb-4 shadow-lg">
            <Hotel size={32} />
          </div>
          <h1 className="text-3xl font-bold text-foreground">{enterpriseName ?? "Guest House PMS"}</h1>
          <p className="text-muted-foreground mt-2">Sign in to your property management system</p>
        </div>

        <Card className="border-0 shadow-xl ring-1 ring-border">
          <CardHeader className="pb-4">
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>
              {enterpriseSlug
                ? "Enter your email and password to access your dashboard."
                : "Enter your enterprise code, email, and password to access your dashboard."}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 bg-destructive-muted text-destructive text-sm rounded-md border border-destructive/30 font-medium">
                  {error}
                </div>
              )}
              {!enterpriseSlug && (
                <div className="space-y-2">
                  <Label htmlFor="code">Enterprise Code</Label>
                  <Input
                    id="code"
                    type="text"
                    placeholder="demo"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@hotel.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <a href="#" className="text-xs text-primary font-medium hover:underline">Forgot password?</a>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-4">
              <Button type="submit" className="w-full h-11 " disabled={isLoading}>
                {isLoading ? "Signing in..." : (
                  <>
                    <KeyRound className="mr-2 w-4 h-4" /> Sign In
                  </>
                )}
              </Button>
              {showDevSeed && (
                <Button type="button" variant="ghost" className="text-xs text-muted-foreground w-full" onClick={handleSeed}>
                  [Dev Tool] Seed Initial Users
                </Button>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
