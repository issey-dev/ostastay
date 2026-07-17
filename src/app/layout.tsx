import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DarkModeProvider } from "@/components/providers/dark-mode-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Guest House PMS",
  description: "Next-Generation Property Management System",
};

// Applies the persisted dark/light preference to <html> before first paint, so there's
// no flash of the wrong theme while DarkModeProvider itself hydrates.
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
      <body className={`${inter.className} antialiased bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100`} suppressHydrationWarning>
        <DarkModeProvider>{children}</DarkModeProvider>
      </body>
    </html>
  );
}
