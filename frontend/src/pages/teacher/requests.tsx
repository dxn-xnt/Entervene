import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Repeat } from "lucide-react";
import { RepostWorkspace } from "@/components/teacher/repost-workspace";

export default function TeacherRequestsPage() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col min-h-0 bg-background">
        <div className="@container/main flex flex-1 flex-col min-h-0">
          <div className="flex flex-1 flex-col min-h-0">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6 border-b-2 border-black">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex items-center gap-2">
                  <Repeat className="size-6 text-foreground" />
                  <h1 className="text-xl font-bold sm:text-2xl md:text-3xl font-head text-foreground">
                    Repost &amp; Material Workspace
                  </h1>
                </div>
              </div>
            </header>
            <main className="flex-1 flex flex-col min-h-0 p-3 sm:p-4 md:p-6">
              <div className="border-2 border-black rounded bg-white shadow-[4px_4px_0px_#000] flex-1 flex flex-col min-h-0 overflow-hidden">
                <RepostWorkspace />
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
