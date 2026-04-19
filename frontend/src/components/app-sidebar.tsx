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

const quarters = [
  "1st Quarter (2025-2026)",
  "2nd Quarter (2025-2026)",
  "3rd Quarter (2025-2026)",
  "4th Quarter (2025-2026)",
];

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  SidebarConfigs
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { role } = useAuth()
  const navRole = (role ?? "student") as keyof typeof SidebarConfigs

  return (
    <Sidebar collapsible="offcanvas" className="no-scrollbar" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="border-b-2 mb-2">
            <SidebarMenuButton
              asChild
              className="hover:border-background! data-[slot=sidebar-menu-button]:p-6!"
            >
              <a href="#">
                <CommandIcon className="size-5!" />
                <span className="text-base font-semibold">Entervene</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <Select defaultValue={quarters[0]}>
          <Select.Trigger className="w-full border-x-background m-0 shadow-none mb-1">
            <Select.Value placeholder="Select Academic Year" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {quarters.map((quarter) => (
                <Select.Item key={quarter} value={quarter}>
                  {quarter}
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
        <NavMain items={data.SidebarConfigs[navRole]} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
