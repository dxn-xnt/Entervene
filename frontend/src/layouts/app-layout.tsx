import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useLayoutEffect, useRef, type CSSProperties, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { AppContent } from './app-content';
import type { BreadcrumbItem } from '@/types';


export default function AppLayout({
  children,
}: PropsWithChildren<{ breadcrumbs?: BreadcrumbItem[] }>) {
  const contentRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const content = contentRef.current;
    const layout = content?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');
    if (!content || !layout || !(pathname.startsWith('/admin') || pathname.startsWith('/teacher'))) return;

    let observedHeader: Element | null = null;
    const selectors = layout.querySelector<HTMLElement>('[data-academic-selectors]');
    const updateAlignment = () => {
      const tabbedHeader = content.querySelector<HTMLElement>('[data-page-tabs-sticky-region]:has([role="tablist"])');
      const header = tabbedHeader ?? content.querySelector<HTMLElement>('[data-app-content] header:has([data-sidebar="trigger"])');
      if (header !== observedHeader) {
        if (observedHeader) resizeObserver.unobserve(observedHeader);
        observedHeader = header;
        if (header) resizeObserver.observe(header);
      }
      if (header && selectors) {
        if (tabbedHeader) {
          layout.dataset.alignedTabbedHeader = '';
          delete layout.dataset.alignedPlainHeader;
        } else {
          layout.dataset.alignedPlainHeader = '';
          delete layout.dataset.alignedTabbedHeader;
        }
        layout.style.setProperty('--aligned-sidebar-brand-height', `${header.getBoundingClientRect().height - (tabbedHeader ? selectors.getBoundingClientRect().height : 0)}px`);
      } else {
        delete layout.dataset.alignedTabbedHeader;
        delete layout.dataset.alignedPlainHeader;
        layout.style.removeProperty('--aligned-sidebar-brand-height');
      }
    };
    const resizeObserver = new ResizeObserver(updateAlignment);
    if (selectors) resizeObserver.observe(selectors);
    const mutationObserver = new MutationObserver(updateAlignment);
    mutationObserver.observe(content, { childList: true, subtree: true });
    updateAlignment();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      delete layout.dataset.alignedTabbedHeader;
      delete layout.dataset.alignedPlainHeader;
      layout.style.removeProperty('--aligned-sidebar-brand-height');
    };
  }, [pathname]);

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
        ref={contentRef}
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
