import React from "react"
import {
  BarChart2, Bell, Book, BookOpen, CheckSquare,
  ClipboardList, LayoutDashboard, School, Settings, Shield, Users,
} from "lucide-react"
import { routes } from "@/../routes"

export type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
}

export const SidebarConfigs: Record<string, NavItem[]> = {
    admin: [
      { title: "Dashboard",       url: routes.admin.dashboard,     icon: <LayoutDashboard /> },
      { title: "Subjects",        url: routes.admin.subjects,       icon: <Book />            },
      { title: "Classes",         url: routes.admin.classes,        icon: <School />          },
      { title: "Users",           url: routes.admin.users,          icon: <Users />           },
      { title: "Interventions",   url: routes.admin.interventions,  icon: <Shield />          },
      { title: "Notifications",   url: routes.admin.notifications,  icon: <Bell />            },
      { title: "System Settings", url: routes.admin.settings,       icon: <Settings />        },
    ],
    teacher: [
      { title: "Dashboard",     url: routes.teacher.dashboard,     icon: <LayoutDashboard /> },
      { title: "Classes",       url: routes.teacher.classes,       icon: <School />          },
      { title: "Classworks",    url: routes.teacher.classworks,    icon: <ClipboardList />   },
      { title: "Interventions", url: routes.teacher.interventions, icon: <Shield />          },
      { title: "Grades",        url: routes.teacher.grades,        icon: <BarChart2 />       },
      { title: "Notifications", url: routes.teacher.notifications, icon: <Bell />            },
    ],
    student: [
      { title: "Study Board",   url: routes.student.board,          icon: <LayoutDashboard /> },
      { title: "Subjects",      url: routes.student.subjects,       icon: <BookOpen />        },
      { title: "Interventions", url: routes.student.interventions,  icon: <Shield />          },
      { title: "Grades",        url: routes.student.grades,         icon: <BarChart2 />       },
      { title: "To Do",         url: routes.student.todo,           icon: <CheckSquare />     },
      { title: "Notifications", url: routes.student.notifications,  icon: <Bell />            },
    ],
  }