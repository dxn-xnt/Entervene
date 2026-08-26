import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { Progress } from "@/components/retroui/Progress";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { getMySchedule, type DynamicScheduleResponse } from "@/lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";
import { ProfileHeader } from "@/components/profile-header";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";

const TEACHER_AVATARS = [
  "/avatars/teacher-avatars/12.svg",
  "/avatars/teacher-avatars/13.svg",
  "/avatars/teacher-avatars/14.svg",
  "/avatars/teacher-avatars/15.svg",
  "/avatars/teacher-avatars/16.svg",
  "/avatars/teacher-avatars/17.svg",
  "/avatars/teacher-avatars/18.svg",
  "/avatars/teacher-avatars/19.svg",
  "/avatars/teacher-avatars/20.svg",
];

const gradeLevelRates = [
  { label: "Grade 7", value: 90 },
  { label: "Grade 8", value: 87 },
  { label: "Grade 9", value: 95 },
  { label: "Grade 10", value: 92 },
  { label: "STEM 11", value: 95 },
  { label: "STEM 12", value: 95 },
];

const subjectMasteryRates = [
  { label: "7 - Science", value: 95 },
  { label: "9 - Compute", value: 87 },
  { label: "9 - English", value: 93 },
  { label: "8 - Filipino", value: 95 },
  { label: "7 - English", value: 87 },
  { label: "8 - Filipino", value: 91 },
];

export default function TeacherProfile() {
  const { user, updateAvatar } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempSelectedAvatar, setTempSelectedAvatar] = useState(
    user?.avatar || "/avatars/teacher-avatars/12.svg",
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
        console.error("Failed to load teacher schedule:", err);
      } finally {
        if (isMounted) setIsScheduleLoading(false);
      }
    }
    void loadSchedule();
    return () => {
      isMounted = false;
    };
  }, []);

  const openModal = () => {
    setTempSelectedAvatar(user?.avatar || "/avatars/teacher-avatars/12.svg");
    setIsModalOpen(true);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div className="flex flex-col items-start">
                  <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                    Profile
                  </h1>
                </div>
              </div>
              <div className="flex flex-row gap-2">
                <Button onClick={openModal}>
                  <Pencil className="size-4 mr-2" /> Edit Profile
                </Button>
              </div>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            <div className="flex flex-col gap-4 py-2 md:gap-6">
              <ProfileHeader user={user} onAvatarClick={openModal} />

              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
                {/* Left column */}
                <div className="flex flex-col gap-3">
                  <h2 className="text-lg font-bold tracking-tight">
                    My Schedule
                  </h2>
                  <DynamicScheduleTable
                    schedule={scheduleData?.schedule || []}
                    isPublished={scheduleData?.is_published}
                    isLoading={isScheduleLoading}
                    emptyMessage="No published schedule assigned to you yet."
                  />
                </div>

                {/* Right column */}
                <Card className="p-4">
                  <h2 className="text-lg font-semibold">Recent Activity</h2>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md border-2 border-black bg-[#fffdf5] rounded-lg shadow-[8px_8px_0_0_#000] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b-2 border-black bg-[#79bd80] px-4 py-3 text-black">
              <h2 className="font-bold text-lg">Edit Profile Avatar</h2>
              <button
                aria-label="Close modal"
                className="rounded p-1 hover:bg-white/30 transition-colors cursor-pointer"
                onClick={() => setIsModalOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-6">
              <div>
                <p className="text-sm font-semibold text-black/70 mb-3">
                  Select your profile picture:
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {TEACHER_AVATARS.map((avatarPath) => {
                    const isSelected = tempSelectedAvatar === avatarPath;
                    return (
                      <button
                        key={avatarPath}
                        onClick={() => setTempSelectedAvatar(avatarPath)}
                        className={`aspect-square p-2 border-2 rounded-lg transition-all duration-200 hover:scale-105 hover:bg-amber-50/50 cursor-pointer ${isSelected
                          ? "border-[#79bd80] bg-amber-100 ring-2 ring-[#79bd80] ring-offset-2"
                          : "border-black bg-white"
                          }`}
                      >
                        <img
                          src={avatarPath}
                          alt="Teacher Avatar Option"
                          className="w-full h-full object-contain"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-row justify-end gap-3 mt-2 border-t border-black/10 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-1.5"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    updateAvatar(tempSelectedAvatar);
                    setIsModalOpen(false);
                  }}
                  className="px-5 py-1.5 bg-[#79bd80] text-black border-2 border-black"
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
