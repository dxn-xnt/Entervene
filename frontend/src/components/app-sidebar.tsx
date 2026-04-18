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
import { CommandIcon, BarChart2, Bell, Book, BookOpen, CheckSquare, ClipboardList, LayoutDashboard, School, Settings, Shield, Users } from "lucide-react"
import { useAuth } from "@/context/AuthContext"

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain:{ 
    admin: [
      {
        title: "Dashboard",
        url: "#",
        icon: (
          <LayoutDashboard />
        ),
      },
      {
        title: "Subjects",
        url: "#",
        icon: (
          <Book />
        ),
      },
      {
        title: "Classes",
        url: "#",
        icon: (
          <School />
        ),
      },
      {
        title: "Users",
        url: "#",
        icon: (
          <Users />
        ),
      },
      {
        title: "Interventions",
        url: "#",
        icon: (
          <Shield />
        ),
      },
      {
        title: "Notifications",
        url: "#",
        icon: (
          <Bell />
        ),
      },
      {
        title: "System Settings",
        url: "#",
        icon: (
          <Settings />
        ),
      },
    ],
    teacher: [
      {
        title: "Dashboard",
        url: "#",
        icon: (
          <LayoutDashboard />
        ),
      },
      {
        title: "Classes",
        url: "#",
        icon: (
          <School />
        ),
      },
      {
        title: "Classworks",
        url: "#",
        icon: (
          <ClipboardList />
        ),
      },
      {
        title: "Interventions",
        url: "#",
        icon: (
          <Shield />
        ),
      },
      {
        title: "Grades",
        url: "#",
        icon: (
          <BarChart2 />
        ),
      },
      {
        title: "Notifications",
        url: "#",
        icon: (
          <Bell />
        ),
      },
    ],
    student: [
      {
        title: "Study Board",
        url: "#",
        icon: (
          <LayoutDashboard />
        ),
      },
      {
        title: "Subjects",
        url: "#",
        icon: (
          <BookOpen />
        ),
      },
      {
        title: "Interventions",
        url: "#",
        icon: (
          <Shield />
        ),
      },
      {
        title: "Grades",
        url: "#",
        icon: (
          <BarChart2 />
        ),
      },
      {
        title: "To Do",
        url: "#",
        icon: (
          <CheckSquare />
        ),
      },
      {
        title: "Notifications",
        url: "#",
        icon: (
          <Bell />
        ),
      },
    ],
  }
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { role } = useAuth()
  const navRole = role ?? "student"

  return (
    <Sidebar collapsible="offcanvas" {...props}>
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
        <NavMain items={data.navMain[navRole]} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
