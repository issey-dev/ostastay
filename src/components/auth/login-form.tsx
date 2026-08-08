"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { KeyRound, Eye, EyeOff } from "@/components/icons"
import { UppsolutIcon, UppsolutStayLockup } from "@/components/brand/uppsolut-logo"
import { InfoHint } from "@/components/ui/info-hint"
import { toast } from "@/lib/toast"

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
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  // Set once login answers mustChangePassword: the account holds a TEMPORARY password
  // and no session exists yet — the form switches to "set your own password" mode.
  const [mustChange, setMustChange] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const routeAfterLogin = (data: { isInternal?: boolean; enterpriseSlug?: string; licenseWarning?: string | null }) => {
    // Grace-period licensing warning — the account signs in, but payment is
    // overdue and access has a hard end date (see /api/auth/login).
    if (data.licenseWarning) toast.error(data.licenseWarning)
    router.push(data.isInternal ? "/osta" : `/e/${data.enterpriseSlug}/dashboard`)
    router.refresh()
  }

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
        if (data.mustChangePassword) {
          setMustChange(true)
          return
        }
        routeAfterLogin(data)
      } else {
        setError(data.error || "Login failed")
      }
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) {
      setError("The passwords do not match")
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          enterpriseSlug: enterpriseSlug ?? code,
          currentPassword: password,
          newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not set the password")
        return
      }
      // The temp password is gone; sign in properly with the new one so every gate on
      // the login route (license, logging) applies in its one place.
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: newPassword, enterpriseSlug: enterpriseSlug ?? code }),
      })
      const loginData = await login.json()
      if (!login.ok) {
        setError(loginData.error || "Password set — sign in with your new password")
        setMustChange(false)
        setPassword("")
        return
      }
      toast.success("Your password is set")
      routeAfterLogin(loginData)
    } catch {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSeed = async () => {
    const res = await fetch("/api/auth/seed", { method: "POST" })
    if (res.ok) {
      toast.success("Seed complete! Use admin@hotel.com and password123 (Enterprise Code: demo)")
    }
  }

  // bg-background, not bg-muted: --muted sits ABOVE --card on the dark ramp, so a muted
  // page left the sign-in card darker than the page behind it — the card receded into a
  // hole instead of lifting off the surface. --background is below --card in both modes,
  // so the card lifts either way.
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Whose name leads here depends on the door you came through. On a tenant's own
            login (/e/[slug]/login) the enterprise name is the headline and Uppsolut steps
            back to a small mark — the tenant's staff are signing into *their* system. On
            the generic /login there is no tenant yet, so the product mark leads. */}
        <div className="text-center mb-8">
          {enterpriseName ? (
            <>
              <UppsolutIcon className="mx-auto mb-4 h-16 w-16 shadow-elevation-2" title={null} />
              <h1 className="text-3xl font-bold text-foreground">{enterpriseName}</h1>
              <p className="text-muted-foreground mt-2">Sign in to your property management system</p>
            </>
          ) : (
            <>
              <h1>
                <UppsolutStayLockup className="mx-auto h-24 w-auto text-foreground" />
              </h1>
              <p className="text-muted-foreground mt-4">Sign in to your property management system</p>
            </>
          )}
        </div>

        {mustChange ? (
          <Card className="border-0 shadow-xl ring-1 ring-border">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
            Set your password
            <InfoHint label="Set your password">You signed in with a temporary password. Choose your own (at least 12 characters) to continue — the temporary one stops working immediately.</InfoHint>
          </CardTitle>
            </CardHeader>
            <form onSubmit={handleChangePassword}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 bg-destructive-muted text-destructive text-sm rounded-md border border-destructive/30 font-medium">
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-4">
                <Button type="submit" className="w-full h-11" disabled={isLoading}>
                  {isLoading ? "Saving..." : (
                    <>
                      <KeyRound className="mr-2 w-4 h-4" /> Set password and continue
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        ) : (
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
                  autoComplete="email"
                  placeholder="admin@hotel.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {/* Deliberately NOT a link. There is no self-service password-reset flow
                      in this app — users are provisioned and reset by an administrator in
                      Controls > Users & Roles. This was an <a href="#"> that looked
                      actionable, focused like a link and did nothing when clicked. Static
                      text is the honest control until a reset flow actually exists. */}
                  <span className="text-xs text-muted-foreground">Forgot it? Ask your administrator</span>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    className="pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
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
        )}
      </div>
    </div>
  )
}
