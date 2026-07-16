import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_super_secret_jwt_key_that_should_be_changed_in_prod"
)

export async function proxy(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const { pathname } = request.nextUrl

  // Protect /dashboard routes. This only confirms a session exists — the JWT carries
  // identity only (no role/enterpriseId), so per-module/per-page authorization always
  // happens server-side via src/lib/scope.ts (requireSession/requirePermission), which
  // re-fetches the live User+Role row on every request. Module-specific redirects belong
  // there (or in the page itself), not here — middleware can't affordably hit the DB.
  if (pathname.startsWith('/dashboard')) {
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
