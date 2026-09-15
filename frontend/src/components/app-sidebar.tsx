import * as React from "react"
import { Link } from "react-router-dom"
import { routes } from "@/../routes"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { AICreditsWidget } from "@/components/teacher/ai-credits-widget"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { EnterveneLogo } from "@/components/logo"
import { useAuth } from "@/context/AuthContext"
import { Select } from "./retroui/Select"
import { SidebarConfigs } from "@/context/sidebar-config"
import { useAcademicPeriod } from "@/context/AcademicPeriodContext"
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { role } = useAuth()
  const navRole = (role ?? "student") as keyof typeof SidebarConfigs
  const { periods, selectedPeriodId, setSelectedPeriodId } = useAcademicPeriod();
  const unreadNotificationCount = useUnreadNotificationCount();

  return (
    <Sidebar collapsible="offcanvas" className="no-scrollbar" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="border-b-2 py-2.5 mb-2">
            <SidebarMenuButton
              asChild
              className="hover:border-background! hover:bg-background! data-[slot=sidebar-menu-button]:p-6!"
            >
              <Link to="#" className="group/brand flex items-center gap-3">
                <EnterveneLogo className="size-10! drop-shadow-[0px_4px_0px_#000] transition-all duration-150 ease-out group-active/brand:translate-y-1 group-active/brand:drop-shadow-none" />
                <span className="text-3xl! font-bold font-head">Entervene</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <Select
          value={selectedPeriodId ? String(selectedPeriodId) : undefined}
          onValueChange={(val) => setSelectedPeriodId(Number(val))}
        >
          <Select.Trigger className="w-full rounded-none border-x-background m-0 shadow-none mb-1">
            <Select.Value placeholder="Active Period" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {periods.map((period) => (
                <Select.Item key={period.id} value={String(period.id)}>
                  <span className="font-bold">{period.period}</span> <span>({period.academicyear})</span>
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
        <NavMain
          items={SidebarConfigs[navRole]}
          badgeCounts={{ Notifications: unreadNotificationCount }}
        />
      </SidebarContent>

      <SidebarFooter>
        {/* AI credits counter — only visible for teachers when AI is configured */}
        {role === "teacher" && <AICreditsWidget />}
        {/* NavUser now reads from AuthContext directly — no props needed */}
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
