import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy.
//
// `script-src` still carries 'unsafe-inline': the theme-init script in
// src/app/layout.tsx and Next's own bootstrap/flight payloads are inline, so a strict
// policy needs a per-request nonce threaded through both — a refactor, not a header
// change (logged as FND-009). 'unsafe-eval' and the ws: connect-src are dev-only (React
// Refresh); production gets neither.
//
// `img-src` deliberately allows https: — a property's logoUrl is tenant-supplied and
// rendered as a plain <img src> (src/components/ui/dashboard-header.tsx and the print
// stationery blocks), so locking this to 'self' would silently break every custom logo.
// data:/blob: cover the eRegistration signature data URLs and the ID-photo preview.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The modern equivalent of X-Frame-Options; the legacy header below stays for older
  // browsers that don't honour this directive.
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  // Load-bearing for the eRegistration ID-photo download route, which streams a
  // guest-uploaded file back with a stored Content-Type — see
  // src/app/api/eregistration/[token]/slots/[slotId]/photo/route.ts.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// HSTS only in production: sending it from a local http://localhost dev server would
// pin the browser to https for localhost and break every other local project too.
if (isProd) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  // Emits .next/standalone: a self-contained server with only the traced runtime
  // dependencies, so the Docker runtime image carries neither the build toolchain nor
  // devDependencies. Harmless outside Docker — `next dev` and `next start` ignore it.
  output: "standalone",

  // Source maps are not emitted for the client bundle by default in production; this
  // makes that explicit so it can't be flipped on accidentally by a future config edit.
  productionBrowserSourceMaps: false,

  // Turns OFF the /_next/image optimization endpoint. Nothing in this app imports
  // next/image (every logo and photo is a plain <img> — the only occurrence of the
  // string is the proxy matcher's exclusion), so the endpoint was reachable but unused:
  // a live attack surface with no callers. It is the host for the sharp/libvips CVEs
  // (GHSA-f88m-g3jw-g9cj), the SVG-decode DoS (GHSA-q8wf-6r8g-63ch), and the classic
  // remote-pattern SSRF. If a future component does adopt next/image, drop this line and
  // add an explicit `remotePatterns` allowlist — never a wildcard, since property
  // logoUrl is tenant-supplied.
  images: { unoptimized: true },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
