"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="bottom-right"
      duration={4500}
      gap={12}
      visibleToasts={4}
      offset={{ right: 16, bottom: 16 }}
      mobileOffset={{ right: 12, left: 12, bottom: 12 }}
      containerAriaLabel="Notifications"
      style={{ zIndex: 999999 }}
      icons={{
        success: <span className="flex size-5 shrink-0 items-center justify-center"><CircleCheck aria-hidden="true" className="size-5" /></span>,
        error: <span className="flex size-5 shrink-0 items-center justify-center"><CircleAlert aria-hidden="true" className="size-5" /></span>,
        warning: <span className="flex size-5 shrink-0 items-center justify-center"><TriangleAlert aria-hidden="true" className="size-5" /></span>,
        info: <span className="flex size-5 shrink-0 items-center justify-center"><Info aria-hidden="true" className="size-5" /></span>,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group pointer-events-auto relative flex h-auto w-full max-w-[24rem] items-start gap-3 rounded border-2 border-black bg-card p-3 text-card-foreground shadow-[4px_4px_0_#000] motion-reduce:transition-none",
          content: "min-w-0 flex-1",
          icon: "flex size-5 shrink-0 items-center justify-center text-foreground",
          title: "font-sans text-sm font-bold leading-5 text-card-foreground",
          description:
            "mt-0.5 font-sans text-xs leading-4 text-muted-foreground",
          success: "border-black",
          error: "border-black",
          warning: "border-black",
          info: "border-black",
          actionButton:
            "ml-auto h-fit min-w-fit border-2 border-border bg-primary px-2 py-1 text-xs font-bold text-primary-foreground shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none",
          cancelButton:
            "ml-auto h-fit min-w-fit border-2 border-border bg-background px-2 py-1 text-xs font-bold text-foreground shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none",
        },
        unstyled: true,
      }}
      {...props}
    />
  );
};

export { Toaster };
