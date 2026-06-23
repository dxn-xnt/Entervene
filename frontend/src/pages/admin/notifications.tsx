import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { SidebarTrigger } from "@/components/ui/sidebar";

import AppLayout from "@/layouts/app-layout";

export default function AdminNotifications() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-4xl font-bold tracking-tight">
                Notifications
              </h1>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />
            <ChartAreaInteractive />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
