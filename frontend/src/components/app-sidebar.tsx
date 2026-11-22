import { AcademicSelectItem } from "@/components/academic-option-label";
import { activeFirst } from "@/lib/active-first";
import * as React from "react";
import { Link } from "react-router-dom";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { AICreditsWidget } from "@/components/teacher/ai-credits-widget";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { EnterveneLogo } from "@/components/logo";
import { useAuth } from "@/context/AuthContext";
import { Select } from "./retroui/Select";
import { SidebarConfigs } from "@/context/sidebar-config";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { role } = useAuth();
  const navRole = (role ?? "student") as keyof typeof SidebarConfigs;
  const {
    academicYears,
    selectedYearId,
    setSelectedYearId,
    periods,
    selectedPeriodId,
    setSelectedPeriodId,
    selectedYear,
    selectedPeriod,
  } = useAcademicPeriod();
  const unreadNotificationCount = useUnreadNotificationCount(true);

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
                <div className="flex flex-col gap-0! -mb-1">
                  <span className="text-3xl! font-bold font-head -mb-1.5">
                    Entervene
                  </span>
                  <span className="text-sm font-semibold font-sans ">
                    MNSTS Learning Hub
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <div
          data-academic-selectors
          className="grid grid-cols-2 border-y-2 border-border mb-1"
        >
          <Select
            value={selectedYearId ? String(selectedYearId) : undefined}
            onValueChange={(val) => {
              const nextId = Number(val);
              if (!isNaN(nextId)) setSelectedYearId(nextId);
            }}
          >
            <Select.Trigger
              aria-label="Select academic year"
              className="w-full min-w-0! rounded-none! border-0 border-r-2 border-border m-0 shadow-none px-2 text-xs"
            >
              <span className="flex! min-w-0 items-center gap-1.5 overflow-visible! whitespace-nowrap!">
                <Select.Value className="text-xs" placeholder="Academic Year" />
                {selectedYear?.is_active && (
                  <span
                    className="size-2 shrink-0 rounded-full border border-black bg-success"
                    title="Active academic year"
                    aria-label="Active academic year"
                  />
                )}
              </span>
            </Select.Trigger>
            <Select.Content className="w-max! max-w-[calc(100vw-2rem)]! min-w-64">
              <Select.Group>
                {activeFirst(academicYears).map((year) => (
                  <AcademicSelectItem
                    key={year.academic_year_id}
                    value={String(year.academic_year_id)}
                    label={year.year_label}
                    active={year.is_active}
                  />
                ))}
              </Select.Group>
            </Select.Content>
          </Select>

          <Select
            value={selectedPeriodId ? String(selectedPeriodId) : undefined}
            onValueChange={(val) => {
              const nextId = Number(val);
              if (!isNaN(nextId)) setSelectedPeriodId(nextId);
            }}
            disabled={periods.length === 0}
          >
            <Select.Trigger
              aria-label="Select academic term"
              className="w-full min-w-0! rounded-none! border-0 m-0 shadow-none px-2 text-xs"
            >
              <span className="flex! min-w-0 items-center gap-1.5 overflow-visible! whitespace-nowrap!">
                <Select.Value
                  className="text-xs"
                  placeholder={
                    periods.length === 0
                      ? "No terms available"
                      : "Active Period"
                  }
                />
                {selectedPeriod?.is_active && (
                  <span
                    className="size-2 shrink-0 rounded-full border border-black bg-success"
                    title="Active academic term"
                    aria-label="Active academic term"
                  />
                )}
              </span>
            </Select.Trigger>
            <Select.Content className="w-max! max-w-[calc(100vw-2rem)]! min-w-64">
              <Select.Group>
                {activeFirst(periods).map((period) => (
                  <AcademicSelectItem
                    key={period.id}
                    value={String(period.id)}
                    label={period.period}
                    active={period.is_active}
                  />
                ))}
              </Select.Group>
            </Select.Content>
          </Select>
        </div>
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
  );
}
