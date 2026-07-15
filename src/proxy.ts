import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_super_secret_jwt_key_that_should_be_changed_in_prod"
)

export async function proxy(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const { pathname } = request.nextUrl

  // Protect /dashboard routes
  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      
      // Simple RBAC Example (can be expanded later):
      // If a HOUSEKEEPING user tries to access /dashboard/financials, kick them out
      const role = payload.role as string;
      if (role === 'HOUSEKEEPING' && (pathname.startsWith('/dashboard/financials') || pathname.startsWith('/dashboard/cashiering') || pathname.startsWith('/dashboard/revenue'))) {
        return NextResponse.redirect(new URL('/dashboard/inventory', request.url))
      }

    } catch (error) {
      // Invalid token
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // If logged in, redirect away from /login
  if (pathname === '/login' && token) {
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
