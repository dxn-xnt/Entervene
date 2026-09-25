import { SidebarInset } from "@/components/ui/sidebar";
import * as React from "react";

interface AppContentProps extends React.ComponentProps<"main"> {
  variant?: "header" | "sidebar";
}

export function AppContent({
  variant = "header",
  children,
  ...props
}: AppContentProps) {
  if (variant === "sidebar") {
    return <SidebarInset {...props}>{children}</SidebarInset>;
  }

  return (
    <main
      data-app-content
      className="retro-squares-bg flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden"
      {...props}
    >
      {children}
    </main>
  );
}
