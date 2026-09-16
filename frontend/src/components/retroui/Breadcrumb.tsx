import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { ChevronRight, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

const BreadcrumbRoot = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav">
>(({ className, ...props }, ref) => (
  <nav
    ref={ref}
    aria-label="breadcrumb"
    className={cn("w-full", className)}
    {...props}
  />
))
BreadcrumbRoot.displayName = "Breadcrumb"

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<"ol">
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      "flex min-w-0 flex-nowrap items-center gap-1.5 text-base font-semibold text-muted-foreground sm:gap-2 sm:text-lg md:text-xl",
      // Root item (first child) has the larger text size
      "[&>li:first-child_a]:!text-xl sm:[&>li:first-child_a]:!text-2xl md:[&>li:first-child_a]:!text-4xl [&>li:first-child_a]:!font-bold",
      "[&>li:first-child_button]:!text-xl sm:[&>li:first-child_button]:!text-2xl md:[&>li:first-child_button]:!text-4xl [&>li:first-child_button]:!font-bold",
      "[&>li:first-child_[aria-current=page]]:!text-xl sm:[&>li:first-child_[aria-current=page]]:!text-2xl md:[&>li:first-child_[aria-current=page]]:!text-4xl [&>li:first-child_[aria-current=page]]:!font-bold",
      // All following items (links, buttons, current page) share the smaller text size matching the rightmost page item
      "[&>li:not(:first-child)_a]:!text-base sm:[&>li:not(:first-child)_a]:!text-lg md:[&>li:not(:first-child)_a]:!text-xl [&>li:not(:first-child)_a]:!font-semibold",
      "[&>li:not(:first-child)_button]:!text-base sm:[&>li:not(:first-child)_button]:!text-lg md:[&>li:not(:first-child)_button]:!text-xl [&>li:not(:first-child)_button]:!font-semibold",
      "[&>li:not(:first-child)_[aria-current=page]]:!text-base sm:[&>li:not(:first-child)_[aria-current=page]]:!text-lg md:[&>li:not(:first-child)_[aria-current=page]]:!text-xl [&>li:not(:first-child)_[aria-current=page]]:!font-bold",
      className
    )}
    {...props}
  />
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("inline-flex items-center", className)} {...props} />
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & { asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"
  return (
    <Comp
      ref={ref}
      className={cn(
        "min-w-0 rounded font-semibold tracking-tight text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    />
  )
})
BreadcrumbLink.displayName = "BreadcrumbLink"

const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    aria-current="page"
    className={cn("min-w-0 font-bold text-foreground", className)}
    {...props}
  />
))
BreadcrumbPage.displayName = "BreadcrumbPage"

const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn("text-muted-foreground [&>svg]:h-4 [&>svg]:w-4", className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
)
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

const BreadcrumbEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    role="presentation"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
)
BreadcrumbEllipsis.displayName = "BreadcrumbEllipsis"

const Breadcrumb = Object.assign(BreadcrumbRoot, {
  List: BreadcrumbList,
  Item: BreadcrumbItem,
  Link: BreadcrumbLink,
  Page: BreadcrumbPage,
  Separator: BreadcrumbSeparator,
  Ellipsis: BreadcrumbEllipsis,
})

export { Breadcrumb }


