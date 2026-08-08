"use client"

import { usePathname } from "next/navigation"
import { ShieldAlert } from "@/components/icons"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { HeaderBrand, HeaderBusinessDate } from "@/components/ui/dashboard-header"
import { PropertyProvider } from "@/components/providers/property-provider"
import { ConfirmProvider } from "@/components/providers/confirm-provider"
import { PropertyBannerBar } from "@/components/ui/property-banner-bar"
import { SupportSessionNotice } from "@/components/ui/support-session-notice"
import { SkipToContent } from "@/components/ui/skip-to-content"
import { EodSessionWatch } from "@/components/providers/eod-session-watch"
import { IdleSessionWatch } from "@/components/providers/idle-session-watch"
import { SupportSessionExitButton } from "@/components/controls/support-session-exit-button"
import { isStationeryRoute } from "@/lib/stationery-routes"

// Splits the dashboard shell in two: the normal app chrome (sidebar, header, banners),
// and a bare pass-through for stationery documents (Invoice, Receipts, Registration
// Card, Confirmation Letter, Statement). Those pages are still nested under
// dashboard/layout.tsx for auth/property-gating (unchanged, still server-side above
// this component) but must render chrome-free on screen, not just during @media print
// — the old `print:hidden` classes on the sidebar/header only hid them at print time,
// leaving the full app shell visible around a "clean" document any other time it was
// viewed or downloaded. Session-timeout watchers keep running either way; only the
// VISIBLE chrome is skipped.
export function DashboardShell({
  children,
  enterpriseName,
  enterpriseSlug,
  isActingAsSupport,
}: {
  children: React.ReactNode
  enterpriseName: string
  enterpriseSlug: string
  isActingAsSupport: boolean
}) {
  const pathname = usePathname()

  if (isStationeryRoute(pathname)) {
    return (
      <PropertyProvider>
        <ConfirmProvider>
          <EodSessionWatch loginPath={`/e/${enterpriseSlug}/login`} />
          <IdleSessionWatch loginPath={`/e/${enterpriseSlug}/login`} />
          {children}
        </ConfirmProvider>
      </PropertyProvider>
    )
  }

  return (
    <PropertyProvider>
      <SidebarProvider>
        {/* First focusable element in the shell — must stay ahead of AppSidebar. */}
        <SkipToContent />
        <div className="print:hidden">
          <AppSidebar />
        </div>
        <main id="main-content" tabIndex={-1} className="w-full bg-background min-h-screen flex flex-col overflow-x-hidden print:overflow-visible outline-none">

          <div className="print:hidden sticky top-0 z-[var(--z-sticky)] flex flex-col w-full">
            <PropertyBannerBar />

            {/* Announces an in-progress End-of-Day roll on the property this session is
                working in, then signs the user out when the date actually rolls. */}
            <EodSessionWatch loginPath={`/e/${enterpriseSlug}/login`} />
            {/* Ends the session after this property's configured idle timeout — a local
                clock in the browser, not another background poll. See the component. */}
            <IdleSessionWatch loginPath={`/e/${enterpriseSlug}/login`} />

            {isActingAsSupport && (
              <SupportSessionNotice
                icon={<ShieldAlert className="h-4 w-4 shrink-0" />}
                message={`You are viewing as Osta support, acting as ${enterpriseName}. All actions are logged.`}
                actions={<SupportSessionExitButton />}
              />
            )}

            {/* Glassmorphism Header */}
            <header className="h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
              <HeaderBrand enterpriseName={enterpriseName} />
              <div className="ml-auto flex items-center gap-4">
                <HeaderBusinessDate />
                <ThemeToggle />
              </div>
            </header>
          </div>

          {/* Floating Main Content Area */}
          <div className="flex-1 p-4 md:p-6 lg:p-8 print:p-0">
            <div className="max-w-7xl mx-auto w-full print:max-w-none">
              <ConfirmProvider>{children}</ConfirmProvider>
            </div>
          </div>
        </main>
      </SidebarProvider>
    </PropertyProvider>
  )
}
