import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { useAuth } from "@/context/AuthContext";
import { Avatar } from "@/components/retroui/Avatar";
import { getMySchedule, type DynamicScheduleResponse } from "@/lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";

const weekDayLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type CalendarDay = {
  date: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  key: string;
};

function buildCalendar(reference: Date) {
  const year = reference.getFullYear();
  const month = reference.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const cells: CalendarDay[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const date = daysInPrevMonth - i;
    cells.push({
      date,
      isCurrentMonth: false,
      isToday: false,
      key: `prev-${date}`,
    });
  }

  for (let date = 1; date <= daysInMonth; date++) {
    const current = new Date(year, month, date);
    cells.push({
      date,
      isCurrentMonth: true,
      isToday: isSameDay(current, today),
      key: `cur-${date}`,
    });
  }

  let nextDate = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      date: nextDate,
      isCurrentMonth: false,
      isToday: false,
      key: `next-${nextDate}`,
    });
    nextDate++;
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const currentWeekIndex = weeks.findIndex((week) =>
    week.some((day) => day.isToday),
  );

  const monthLabel = reference.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return { weeks, currentWeekIndex, monthLabel };
}

const StudentProfile = () => {
  const { user } = useAuth();
  const { weeks, currentWeekIndex, monthLabel } = useMemo(
    () => buildCalendar(new Date()),
    [],
  );

  const [scheduleData, setScheduleData] = useState<DynamicScheduleResponse | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadSchedule() {
      setIsScheduleLoading(true);
      try {
        const data = await getMySchedule();
        if (isMounted) setScheduleData(data);
      } catch (err) {
        console.error("Failed to fetch schedule:", err);
      } finally {
        if (isMounted) setIsScheduleLoading(false);
      }
    }
    void loadSchedule();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                Profile
              </h1>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
              <Card className="flex flex-row items-center gap-4 p-4 md:p-6">
              <Avatar
                variant="student"
                className="h-12 w-12 shrink-0 bg-amber-100"
              >
                <Avatar.Image src={user?.avatar || "/avatars/student-avatars/1.svg"} alt={user?.fullName || "User"} />
                <Avatar.Fallback>{user?.fullName?.charAt(0) || "U"}</Avatar.Fallback>
              </Avatar>
              <div className="flex flex-col">
                <p className="text-lg font-bold">
                  {user?.fullName ?? "John Doe"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {user?.email ?? "johndoe@example.com"}
                </p>
              </div>
            </Card>

              <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
              <div className="flex flex-col gap-3 flex-1">
                <p className="text-2xl md:text-3xl font-bold tracking-tight">
                  My Schedule
                </p>
                <DynamicScheduleTable
                  schedule={scheduleData?.schedule || []}
                  isPublished={scheduleData?.is_published}
                  isLoading={isScheduleLoading}
                />
              </div>

              <div className="flex flex-col gap-3 w-full lg:w-80">
                <div className="flex flex-row items-center justify-between">
                  <p className="text-2xl md:text-3xl font-bold tracking-tight">
                    Current Week
                  </p>
                </div>

                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex flex-row items-center justify-between">
                    <p className="font-semibold">{monthLabel}</p>
                    <button className="text-xs text-muted-foreground border rounded-md px-2 py-1">
                      Today
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
                    {weekDayLabels.map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1">
                    {weeks.map((week, weekIdx) => (
                      <div
                        key={weekIdx}
                        className="grid grid-cols-7 gap-1 text-center text-sm"
                      >
                        {week.map((day) => (
                          <span
                            key={day.key}
                            className={`flex items-center justify-center rounded-md py-1 ${
                              weekIdx === currentWeekIndex
                                ? "bg-green-400 font-semibold"
                                : ""
                            } ${
                              !day.isCurrentMonth &&
                              weekIdx !== currentWeekIndex
                                ? "text-muted-foreground/50"
                                : ""
                            }`}
                          >
                            {day.date}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentProfile;
