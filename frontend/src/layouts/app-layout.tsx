import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { CSSProperties, PropsWithChildren } from 'react';
import { AppContent } from './app-content';
import type { BreadcrumbItem } from '@/types';


export default function AppLayout({
  children,
}: PropsWithChildren<{ breadcrumbs?: BreadcrumbItem[] }>) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >

      <AppSidebar variant="inset" />
      <SidebarInset
        className="h-svh overflow-hidden"
        data-teacher-page={window.location.pathname.startsWith('/teacher') || undefined}
        data-student-page={window.location.pathname.startsWith('/student') || undefined}
        data-admin-page={window.location.pathname.startsWith('/admin') || undefined}
      >
        <AppContent>
          {/* <SiteHeader breadcrumbs={breadcrumbs}/> */}
          {children}
        </AppContent>
      </SidebarInset>
    </SidebarProvider>
  );
}
