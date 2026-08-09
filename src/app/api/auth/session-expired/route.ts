import { NextResponse } from "next/server";
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
export async function GET(request: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", request.url));
}
