import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/student/button";
import { Badge } from "@/components/retroui/Badge";
import { useAuth } from "@/context/AuthContext";
import { Avatar } from "@/components/retroui/Avatar";
import {
  getMySchedule,
  getMyStudentProfile,
  type DynamicScheduleResponse,
  type MyStudentProfileResponse,
} from "@/lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";
import StudentQRBadgeModal from "@/components/StudentQRBadgeModal";
import { Pencil, QrCode } from "lucide-react";
import { RoleBadge } from "@/components/role-badge";
import { Dialog } from "@/components/retroui/Dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { useToast } from "@/components/retroui/Toast";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { NoChangesMessage } from "@/components/retroui/FormMessage";

const weekDayLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const STUDENT_AVATARS = Array.from(
  { length: 11 },
  (_, index) => `/avatars/student-avatars/${index + 1}.svg`,
);

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
  const toast = useToast();
  const { user, updateAvatar } = useAuth();
  const { weeks, currentWeekIndex, monthLabel } = useMemo(
    () => buildCalendar(new Date()),
    [],
  );

  const [scheduleData, setScheduleData] =
    useState<DynamicScheduleResponse | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(true);
  const [studentProfile, setStudentProfile] =
    useState<MyStudentProfileResponse | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [tempSelectedAvatar, setTempSelectedAvatar] = useState(
    user?.avatar || "/avatars/student-avatars/1.svg",
  );
  const avatarChanges = useEditFormChanges({
    initialValues: user?.avatar || "/avatars/student-avatars/1.svg",
    values: tempSelectedAvatar,
    resetKey: String(isEditProfileOpen),
  });

  useEffect(() => {
    if (isEditProfileOpen) {
      setTempSelectedAvatar(user?.avatar || "/avatars/student-avatars/1.svg");
    }
  }, [isEditProfileOpen, user?.avatar]);

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

    async function loadProfile() {
      try {
        const profile = await getMyStudentProfile();
        if (isMounted) setStudentProfile(profile);
      } catch (err) {
        console.error("Failed to fetch student profile:", err);
      }
    }

    void loadSchedule();
    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                  Profile
                </h1>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <Button
                  type="button"
                  size="header"
                  onClick={() => setIsEditProfileOpen(true)}
                  className="flex-1 whitespace-nowrap sm:flex-none"
                >
                  <Pencil className="size-4" />
                  Edit Profile
                </Button>
                <Button
                  type="button"
                  size="header"
                  variant="outline"
                  onClick={() => setQrOpen(true)}
                  disabled={!studentProfile}
                  className="flex-1 whitespace-nowrap sm:flex-none"
                >
                  <QrCode className="size-4" />
                  View QR Badge
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <Card className="flex flex-col items-start justify-between gap-4 border-black bg-primary p-4 shadow-md hover:shadow-none sm:flex-row sm:items-center md:p-6">
                <div className="flex flex-row items-center gap-4">
                  <Avatar
                    variant="student"
                    className="h-12 w-12 shrink-0 bg-amber-100"
                  >
                    <Avatar.Image
                      src={user?.avatar || "/avatars/student-avatars/1.svg"}
                      alt={user?.fullName || "User"}
                    />
                    <Avatar.Fallback>
                      {user?.fullName?.charAt(0) || "U"}
                    </Avatar.Fallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold">
                        {studentProfile?.student_name ||
                          user?.fullName ||
                          "Student"}
                      </p>
                      <RoleBadge role="student" className="mt-1.5" />
                    </div>
                    <p className="text-sm">
                      {user?.email ?? "student@example.com"}
                    </p>
                  </div>
                </div>

                {(studentProfile?.student_lrn ||
                  studentProfile?.grade_level ||
                  studentProfile?.section_name) && (
                  <div className="flex flex-col items-start gap-1 text-sm sm:items-end">
                    {studentProfile?.student_lrn && (
                      <Badge variant="solid" size="sm">
                        LRN: {studentProfile.student_lrn}
                      </Badge>
                    )}
                    {(studentProfile?.grade_level ||
                      studentProfile?.section_name) && (
                      <div className="flex items-center gap-1">
                        {studentProfile?.grade_level && (
                          <span className="font-semibold">
                            {studentProfile.grade_level}
                          </span>
                        )}
                        {studentProfile?.section_name && (
                          <span className="font-semibold">
                            {studentProfile.section_name}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
                <div className="flex flex-col gap-3 flex-1">
                  <p className="text-2xl md:text-3xl font-bold">My Schedule</p>
                  <DynamicScheduleTable
                    schedule={scheduleData?.schedule || []}
                    isPublished={scheduleData?.is_published}
                    isLoading={isScheduleLoading}
                  />
                </div>

                <div className="flex flex-col gap-3 w-full lg:w-80">
                  <div className="flex flex-row items-center justify-between">
                    <p className="text-2xl md:text-3xl font-bold">
                      Current Week
                    </p>
                  </div>

                  <Card className="flex flex-col gap-3 border-black bg-white p-4 shadow-md hover:shadow-none">
                    <div className="flex flex-row items-center justify-between">
                      <p className="font-semibold">{monthLabel}</p>
                      <Badge
                        variant="secondary"
                        size="sm"
                        className="rounded border border-black bg-primary text-sm font-bold text-black"
                      >
                        Today
                      </Badge>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center text-sm text-muted-foreground">
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
                              className={`flex items-center justify-center py-1 ${
                                weekIdx === currentWeekIndex
                                  ? "bg-black font-semibold text-white"
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

      <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
        <Dialog.Content size="md">
          <Dialog.Header>
            <Dialog.Title className="font-sans text-xl font-bold">
              Edit Profile Avatar
            </Dialog.Title>
          </Dialog.Header>

          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <p className="mb-3 text-sm font-semibold">
              Select your profile picture:
            </p>
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              {STUDENT_AVATARS.map((avatarPath, index) => {
                const isSelected = tempSelectedAvatar === avatarPath;
                return (
                  <Tooltip key={avatarPath}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Select student avatar ${index + 1}`}
                          aria-pressed={isSelected}
                          onClick={() => setTempSelectedAvatar(avatarPath)}
                          className={`aspect-square cursor-pointer rounded border-2 p-2 transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/20 ring-2 ring-primary ring-offset-2 ring-offset-background"
                              : "border-border bg-card hover:bg-accent"
                          }`}
                        >
                          <img
                            src={avatarPath}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        </button>
                      }
                    />
                    <TooltipContent>Select avatar {index + 1}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          <Dialog.Footer className="mt-0">
            <NoChangesMessage message={avatarChanges.noChangesMessage} />
            <Button
              type="button"
              variant="outline"
              autoIcon={false}
              onClick={() => setIsEditProfileOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!avatarChanges.hasChanges}
              onClick={async () => {
                if (!avatarChanges.guardChanges()) return;
                try {
                  await updateAvatar(tempSelectedAvatar);
                  toast.success({ title: "Avatar updated" });
                  setIsEditProfileOpen(false);
                } catch (error) {
                  toast.error({
                    title: "Unable to save avatar",
                    description:
                      error instanceof Error ? error.message : undefined,
                  });
                }
              }}
            >
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      <StudentQRBadgeModal
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        student={studentProfile}
      />
    </AppLayout>
  );
};

export default StudentProfile;
