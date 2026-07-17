import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_super_secret_jwt_key_that_should_be_changed_in_prod"
)

export async function proxy(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const { pathname } = request.nextUrl

  // Protect /dashboard routes (both the legacy bare path — see
  // src/app/dashboard/[[...rest]]/page.tsx for its redirect-to-slug handling — and the
  // real /e/{slug}/dashboard/... ones). This only confirms a session exists — the JWT
  // carries identity only (no role/enterpriseId), so per-module/per-page authorization
  // always happens server-side via src/lib/scope.ts (requireSession/requirePermission),
  // which re-fetches the live User+Role row on every request, and the enterprise slug
  // itself is re-validated against the live session in src/app/e/[slug]/layout.tsx.
  // Middleware can't affordably hit the DB, so none of that happens here.
  const isDashboardPath = pathname.startsWith('/dashboard') || /^\/e\/[^/]+\/dashboard(\/|$)/.test(pathname)
  if (isDashboardPath) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    try {
      await jwtVerify(token, JWT_SECRET)
    } catch (error) {
      // Invalid token
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // If logged in, redirect away from /login or any enterprise's dedicated login page
  const isLoginPage = pathname === '/login' || /^\/e\/[^/]+\/login$/.test(pathname)
  if (isLoginPage && token) {
    try {
      await jwtVerify(token, JWT_SECRET)
      return NextResponse.redirect(new URL('/dashboard', request.url))
    } catch (error) {
      // invalid token, let them log in
    }
  }

  // Redirect root to dashboard
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
