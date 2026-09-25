
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { getMySchedule, type DynamicScheduleResponse } from "@/lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";
import { ProfileHeader } from "@/components/profile-header";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

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
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex flex-col items-start">
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                    Profile
                  </h1>
                </div>
              </div>
              <div className="flex w-full flex-row gap-2 sm:w-auto">
                <Button
                  size="header"
                  onClick={openModal}
                  className="w-full whitespace-nowrap sm:w-auto"
                >
                  <Pencil className="size-4" /> Edit Profile
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:gap-6 md:px-6">
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

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <Dialog.Content className="max-w-md">
          <Dialog.Header>
            <Dialog.Title className="text-lg font-bold">Edit Profile Avatar</Dialog.Title>
          </Dialog.Header>

          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <p className="mb-3 text-sm font-semibold">
              Select your profile picture:
            </p>
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  {TEACHER_AVATARS.map((avatarPath) => {
                    const isSelected = tempSelectedAvatar === avatarPath;
                    return (
                      <button
                        key={avatarPath}
                        type="button"
                        aria-label={`Select teacher avatar ${TEACHER_AVATARS.indexOf(avatarPath) + 1}`}
                        aria-pressed={isSelected}
                        onClick={() => setTempSelectedAvatar(avatarPath)}
                        className={`aspect-square cursor-pointer rounded border-2 p-2 transition-colors ${isSelected
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
                    );
                  })}
            </div>
          </div>

          <Dialog.Footer className="mt-0">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await updateAvatar(tempSelectedAvatar);
                  setIsModalOpen(false);
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : "Unable to save avatar.");
                }
              }}
            >
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </AppLayout>
  );
}
