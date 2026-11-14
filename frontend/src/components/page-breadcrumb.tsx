/* eslint-disable react-refresh/only-export-components -- Preserve RetroUI's compound Breadcrumb API. */
import type { ComponentProps } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { cn } from "@/lib/utils";

function PageBreadcrumbRoot({ className, ...props }: ComponentProps<typeof Breadcrumb>) {
  return (
    <Breadcrumb
      className={cn(
        "min-w-0 overflow-hidden tracking-normal [&_a]:tracking-normal! [&_ol]:whitespace-nowrap [&_li]:shrink-0 [&_li:last-child]:min-w-0 [&_li:last-child]:shrink [&_li:last-child]:overflow-hidden [&_[aria-current=page]]:block [&_[aria-current=page]]:truncate",
        className,
      )}
      {...props}
    />
  );
}

export const PageBreadcrumb = Object.assign(PageBreadcrumbRoot, {
  List: Breadcrumb.List,
  Item: Breadcrumb.Item,
  Link: Breadcrumb.Link,
  Page: Breadcrumb.Page,
  Separator: Breadcrumb.Separator,
  Ellipsis: Breadcrumb.Ellipsis,
});
