import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { type PropsWithChildren } from 'react';
import { AppContent } from './app-content';
import SiteHeader from '@/components/site-header';
import type { BreadcrumbItem } from '@/types';

export default function AppLayout({
    children,
    breadcrumbs = [],
}: PropsWithChildren<{ breadcrumbs?: BreadcrumbItem[] }>) {
    return (
      <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <AppContent>
        <SiteHeader breadcrumbs={breadcrumbs}/>
          {children}
        </AppContent>
      </SidebarInset>
    </SidebarProvider>
    );
}
