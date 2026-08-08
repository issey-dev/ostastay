import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { DarkModeProvider } from "@/components/providers/dark-mode-provider";
import { Toaster } from "@/components/ui/toaster";
import { CRIMSON_OS, PRODUCT_NAME } from "@/lib/brand";

// Inter is loaded as a VARIABLE font (no `weight` option), which is what makes the
// wordmark possible: the lockup needs 900 for "UPP" and 300 for "SOLUT" in the same
// string, and both come from this one file rather than two extra downloads.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// The brand guide reserves a mono face for "labels and readouts" (§07 Typography).
// Until now --font-mono aliased the sans stack, so ~45 `font-mono` call sites — sync
// logs, DB-health readouts, charge codes, confirmation numbers — rendered in Inter.
// They now get an actual mono face, which is the point of tagging them mono at all.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  // `template` gives every page "<Page> · Uppsolut Stay" without each route repeating
  // the brand. Routes that set no title fall back to `default`.
  title: {
    default: PRODUCT_NAME,
    template: `%s · ${PRODUCT_NAME}`,
  },
  // Plain description on purpose — "Next-Generation" was here, and DESIGN_PLAN §0.2
  // bans that vocabulary ("Next-Gen", "Seamless", "Unleash", "Elevate", "Revolutionize")
  // from UI copy. This string is the browser tab title's companion and the share preview.
  description: "Property management for guesthouses and resorts",
  applicationName: PRODUCT_NAME,
  manifest: "/site.webmanifest",
  // Wired explicitly rather than via the app/icon.* file convention: the brand kit ships
  // a full set (outlined-U .ico/.svg/.png at every size, baked from the real Inter Black
  // glyph by branding-guide/.../bake-inter-favicons.py), and listing them here keeps the
  // markup identical to the kit's own favicon-snippet.html.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// Next 16 takes theme-color on the `viewport` export, not `metadata`. Crimson OS is the
// brand's stated primary, and it is what tints the mobile browser chrome. Sourced from
// src/lib/brand.ts because metadata is generated server-side and cannot read a CSS var.
export const viewport: Viewport = {
  themeColor: CRIMSON_OS,
};

// Applies the persisted dark/light preference to <html> before first paint, so there's
// no flash of the wrong theme while DarkModeProvider itself hydrates.
//
// This logs a dev-only React warning on every page load: "Encountered a script tag
// while rendering React component". It is noise, not a bug — the tag IS emitted into
// the streamed HTML and DOES run before first paint (verified: with theme-mode=dark in
// localStorage, <html> already carries .dark on arrival). Swapping it for next/script
// with strategy="beforeInteractive" was tried and does NOT silence the warning.
// The only known way to remove it is to drop the script entirely and drive the theme
// from a cookie read server-side here — see .agents/docs/TODO.md. Don't re-litigate the
// next/script route.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem('theme-mode') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* `inter.variable`, not `inter.className`: className sets font-family directly on
          the body and would outrank the --font-sans stack, cutting Helvetica out of the
          chain. Exposing the variable instead lets `html { @apply font-sans }` resolve to
          Inter → next/font's metric-matched fallback → Helvetica → Arial (globals.css). */}
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground`} suppressHydrationWarning>
        <DarkModeProvider>{children}</DarkModeProvider>
        <Toaster />
      </body>
    </html>
  );
}
