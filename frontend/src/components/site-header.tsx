import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb } from "./retroui/Breadcrumb"
import { Fragment } from "react"
import type { BreadcrumbItem } from "@/types"

export default function SiteHeader({
  breadcrumbs = [],
}: { breadcrumbs?: BreadcrumbItem[] }) {
  const hasBreadcrumbs = breadcrumbs.length > 0

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 mt-[5px] transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumb className="min-w-0">
          <Breadcrumb.List>
            {hasBreadcrumbs ? (
              breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1

                return (
                  <Fragment key={`${crumb.href}-${crumb.title}-${index}`}>
                    <Breadcrumb.Item className="max-w-[180px] sm:max-w-none truncate">
                      {isLast ? (
                        <Breadcrumb.Page className="truncate">{crumb.title}</Breadcrumb.Page>
                      ) : (
                        <Breadcrumb.Link href={crumb.href} className="truncate">
                          {crumb.title}
                        </Breadcrumb.Link>
                      )}
                    </Breadcrumb.Item>
                    {!isLast && <Breadcrumb.Separator />}
                  </Fragment>
                )
              })
            ) : (
              <Breadcrumb.Item>
                <Breadcrumb.Page>Dashboard</Breadcrumb.Page>
              </Breadcrumb.Item>
            )}
          </Breadcrumb.List>
        </Breadcrumb>
      </div>
    </header>
  )
}
