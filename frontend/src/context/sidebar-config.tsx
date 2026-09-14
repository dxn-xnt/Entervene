import React from "react"
import {
  BarChart2, Bell, Book, BookOpen, BookOpenCheck, CheckSquare,
  ClipboardList, LayoutDashboard, School, Settings, Shield, Users, Sparkles, Calendar, UserCheck, TableProperties
} from "lucide-react"
import { routes } from "@/../routes"

export type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
  activePaths?: string[]
}

export const SidebarConfigs: Record<string, NavItem[]> = {
  admin: [
    { title: "Dashboard", url: routes.admin.dashboard, icon: <LayoutDashboard /> },
    { title: "Subjects", url: routes.admin.subjects, icon: <Book /> },
    { title: "Classes", url: routes.admin.classes, icon: <School /> },
    { title: "Subject Load", url: routes.admin.subjectLoadStudio, icon: <Calendar /> },
    { title: "Substitutions", url: routes.admin.substitutions, icon: <UserCheck /> },
    { title: "Users", url: routes.admin.users, icon: <Users /> },

    { title: "AI Predictions", url: routes.admin.predictions, icon: <Sparkles /> },
    { title: "Interventions", url: routes.admin.interventions, icon: <Shield /> },
    { title: "Notifications", url: routes.admin.notifications, icon: <Bell /> },
    { title: "System Settings", url: routes.admin.settings, icon: <Settings /> },
  ],
  teacher: [
    { title: "Dashboard", url: routes.teacher.dashboard, icon: <LayoutDashboard /> },
    {
      title: "Classes",
      url: routes.teacher.classes,
      icon: <School />,
      activePaths: ["/teacher/advisory-class"],
    },
    { title: "Attendance", url: routes.teacher.attendance, icon: <UserCheck /> },
    { title: "Classworks", url: routes.teacher.classworks, icon: <ClipboardList /> },
    // { title: "Lessons",        url: routes.teacher.lessons,       icon: <Book />            },
    { title: "Lesson Planner", url: routes.teacher.lessonPlanner, icon: <BookOpenCheck /> },
    { title: "TOS Generator", url: routes.teacher.tos, icon: <TableProperties /> },
    { title: "AI Predictions", url: routes.teacher.predictions, icon: <Sparkles /> },
    { title: "Interventions", url: routes.teacher.interventions, icon: <Shield /> },
    { title: "Grades", url: routes.teacher.grades, icon: <BarChart2 /> },
    { title: "Notifications", url: routes.teacher.notifications, icon: <Bell /> },
  ],
  student: [
    { title: "Study Board", url: routes.student.board, icon: <LayoutDashboard /> },
    { title: "Subjects", url: routes.student.subjects, icon: <BookOpen /> },
    { title: "Interventions", url: routes.student.interventions, icon: <Shield /> },
    { title: "Grades", url: routes.student.grades, icon: <BarChart2 /> },
    { title: "To Do", url: routes.student.todo, icon: <CheckSquare /> },
    { title: "Notifications", url: routes.student.notifications, icon: <Bell /> },
  ],
}
