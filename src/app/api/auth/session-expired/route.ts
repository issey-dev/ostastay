import { destroySession } from "@/lib/auth";

// A Server Component that finds requireSession() failing can't clear the auth_token
// cookie itself — Next.js only allows cookie mutation from a Server Action or Route
// Handler, never during a page/layout's render. That meant a token that is still
// JWT-signature-valid but no longer honoured (idle timeout, forced sign-out, a
// pre-2026-08-04 token, or an enterprise deleted out from under a live session) stayed in
// the browser after redirect("/login"). proxy.ts's bounce-if-already-authenticated check
// on /login only verifies the JWT signature, so it sent that still-cookied browser
// straight back to /dashboard — which failed the same requireSession() check and
// redirected back here, forever: the "too many redirects" crash. Route Handlers CAN clear
// cookies, so every one of those redirect("/login") call sites points here instead.
//
// The Location is deliberately RELATIVE. In the standalone server (Dockerfile sets
// HOSTNAME=0.0.0.0 so it listens on every interface behind Caddy), a Route Handler's
// request.url is built from that bind address, not the browser's Host header — so the
// old `NextResponse.redirect(new URL("/login", request.url))` sent users to
// https://0.0.0.0:3000/login on every session timeout. A relative Location is resolved
// by the browser against the public URL it actually requested (RFC 9110 §10.2.2), which
// is also what proxy.ts's redirects already emit. Don't build an absolute URL here.
export async function GET() {
  await destroySession();
  return new Response(null, { status: 307, headers: { Location: "/login" } });
}
