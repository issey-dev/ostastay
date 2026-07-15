import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="w-full bg-[#F8FAFC] min-h-screen flex flex-col overflow-x-hidden">
        
        {/* Glassmorphism Header */}
        <header className="h-16 bg-white/70 backdrop-blur-md sticky top-0 z-10 flex items-center px-4 w-full shadow-[0_1px_3px_0_rgba(0,0,0,0.02)]">
          <SidebarTrigger className="text-slate-500 hover:text-indigo-600 transition-colors" />
          <h1 className="ml-4 font-bold text-lg text-slate-800 font-outfit tracking-tight">Guest House PMS</h1>
        </header>
        
        {/* Floating Main Content Area */}
        <div className="flex-1 p-4 md:p-8">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
