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
      className="retro-squares-bg flex min-w-0 w-full flex-1 flex-col gap-4"
      {...props}
    >
      {children}
    </main>
  );
}
