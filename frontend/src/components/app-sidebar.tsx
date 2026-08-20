import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { CommandIcon } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { Select } from "./retroui/Select"
import { SidebarConfigs } from "@/context/sidebar-config"
import { useAcademicPeriod } from "@/context/AcademicPeriodContext"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { role } = useAuth()
  const navRole = (role ?? "student") as keyof typeof SidebarConfigs
  const { periods, selectedPeriodId, setSelectedPeriodId, isLoading } = useAcademicPeriod()

  return (
    <Sidebar collapsible="offcanvas" className="no-scrollbar" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="border-b-2 py-2.5 mb-2">
            <SidebarMenuButton
              asChild
              className="hover:border-background! data-[slot=sidebar-menu-button]:p-6!"
            >
              <a href="#" className="gap-2">
                <CommandIcon className="size-6!" />
                <span className="text-2xl! font-bold ">Entervene</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <Select 
          value={selectedPeriodId ? String(selectedPeriodId) : undefined}
          onValueChange={(val) => setSelectedPeriodId(Number(val))}
        >
          <Select.Trigger className="w-full border-x-background m-0 shadow-none mb-1">
            <Select.Value placeholder={isLoading ? "Loading..." : "Active Period"} />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {periods.map((period) => (
                <Select.Item key={period.id} value={String(period.id)}>
                  {period.period} ({period.academicyear})
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
        <NavMain items={SidebarConfigs[navRole]} />
      </SidebarContent>

      <SidebarFooter>
        {/* NavUser now reads from AuthContext directly — no props needed */}
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
