import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DarkModeProvider } from "@/components/providers/dark-mode-provider";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "OstaStay",
  description: "Next-Generation Property Management System",
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
      <body className={`${inter.className} antialiased bg-background text-foreground`} suppressHydrationWarning>
        <DarkModeProvider>{children}</DarkModeProvider>
        <Toaster />
      </body>
    </html>
  );
}
