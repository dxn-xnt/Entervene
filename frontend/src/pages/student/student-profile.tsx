import { useMemo } from "react";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Table } from "@/components/retroui/Table";
import { useAuth } from "@/context/AuthContext";
import { Avatar } from "@/components/retroui/Avatar";

type ScheduleRow =
  | {
      type: "class";
      subject: string;
      time: string;
      days: string[];
    }
  | {
      type: "break";
      label: string;
    };

const schedule: ScheduleRow[] = [
  {
    type: "class",
    subject: "Computer Programming",
    time: "7:45 am - 8:45 am",
    days: ["M", "T", "W", "Th", "F"],
  },
  {
    type: "class",
    subject: "Filipino",
    time: "8:45 am - 9:45 am",
    days: ["M", "T", "W", "Th", "F"],
  },
  { type: "break", label: "Break" },
  {
    type: "class",
    subject: "Science",
    time: "10:00 am - 11:00 am",
    days: ["M", "T", "W", "Th", "F"],
  },
  {
    type: "class",
    subject: "English",
    time: "11:00 am - 12:00 nn",
    days: ["M", "T", "W", "Th", "F"],
  },
  { type: "break", label: "Lunch Break" },
  {
    type: "class",
    subject: "Mathematics",
    time: "1:00 pm - 2:00 pm",
    days: ["M", "T", "W", "Th", "F"],
  },
  {
    type: "class",
    subject: "MAPEH",
    time: "2:00 pm - 3:00 pm",
    days: ["M", "T", "W", "Th", "F"],
  },
  {
    type: "class",
    subject: "System Designs",
    time: "3:00 pm - 4:00 pm",
    days: ["M", "T", "W", "Th", "F"],
  },
];

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

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3 pb-4 -mx-4 md:-mx-6 px-4 md:px-6 border-b border-gray-500">
              <p className="text-2xl md:text-4xl font-bold tracking-tight">
                Profile
              </p>
            </header>

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
                <Table
                  wrapperClassName="shadow-md transition-all hover:shadow-none"
                  className="table-fixed rounded-lg bg-white"
                >
                  <Table.Header className="bg-card">
                    <Table.Row className="hover:bg-card">
                      <Table.Head className="w-2/5">Subject</Table.Head>
                      <Table.Head className="text-center">Time</Table.Head>
                      <Table.Head className="text-right w-48">Days</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {schedule.map((row, idx) =>
                      row.type === "break" ? (
                        <Table.Row
                          key={idx}
                          className="hover:bg-white bg-white"
                        >
                          <Table.Cell
                            colSpan={3}
                            className="text-center text-sm text-muted-foreground"
                          >
                            {row.label}
                          </Table.Cell>
                        </Table.Row>
                      ) : (
                        <Table.Row key={idx} className="hover:bg-white">
                          <Table.Cell className="font-semibold">
                            {row.subject}
                          </Table.Cell>
                          <Table.Cell className="text-center">
                            <span className="inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs">
                              {row.time}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex flex-row justify-end gap-1">
                              {row.days.map((day) => (
                                <span
                                  key={day}
                                  className="flex size-6 items-center justify-center rounded-full border text-xs"
                                >
                                  {day}
                                </span>
                              ))}
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ),
                    )}
                  </Table.Body>
                </Table>
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
    </AppLayout>
  );
};

export default StudentProfile;
