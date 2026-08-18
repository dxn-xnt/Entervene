import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { apiFetch } from "@/lib/api";
import {
  getStudentAttendanceSummary,
  submitLeaveRequest,
  type AttendanceSummaryResponse,
} from "@/lib/attendance-api";
import {
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  Loader2,
  Plus,
  Check,
  X,
} from "lucide-react";

type ClassOption = {
  class_id: number;
  section_name: string;
};

export default function StudentAttendancePage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [summary, setSummary] = useState<AttendanceSummaryResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  // Leave request modal state
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveSuccess, setLeaveSuccess] = useState(false);

  // Load student profile & classes
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const resUser = await apiFetch("/api/v1/auth/me");
        const user = resUser.ok ? await resUser.json() : null;

        if (user && user.student_id) {
          const resClasses = await apiFetch("/api/v1/classes");
          const classList: ClassOption[] = resClasses.ok
            ? await resClasses.json()
            : [];
          setClasses(classList);

          const summaryData = await getStudentAttendanceSummary(
            user.student_id,
          );
          setSummary(summaryData);
        }
      } catch (err) {
        console.error("Failed to load student attendance:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Update summary when class changes
  useEffect(() => {
    async function updateClassSummary() {
      try {
        const resUser = await apiFetch("/api/v1/auth/me");
        const user = resUser.ok ? await resUser.json() : null;
        if (user && user.student_id) {
          const data = await getStudentAttendanceSummary(
            user.student_id,
            selectedClassId || undefined,
          );
          setSummary(data);
        }
      } catch (err) {
        console.error("Failed to update summary:", err);
      }
    }
    if (selectedClassId !== null) {
      updateClassSummary();
    }
  }, [selectedClassId]);

  // Submit Leave Request
  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].class_id);
    }
    const targetClassId = selectedClassId || (classes[0]?.class_id ?? 1);

    try {
      setSubmittingLeave(true);
      await submitLeaveRequest({
        class_id: targetClassId,
        start_date: startDate,
        end_date: endDate,
        reason: reason,
      });
      setLeaveSuccess(true);
      setTimeout(() => {
        setLeaveSuccess(false);
        setShowLeaveModal(false);
        setReason("");
      }, 2000);
    } catch (err) {
      console.error("Failed to submit leave request:", err);
      alert("Error submitting leave request.");
    } finally {
      setSubmittingLeave(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                    My Attendance & Leave Requests
                  </h1>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setShowLeaveModal(true)}
                className="gap-2 whitespace-nowrap font-bold"
              >
                <Plus className="size-3.5" /> Submit Leave Request
              </Button>
            </header>

            <div className="-mx-4 -mt-[1px] border-b-2 border-border md:-mx-6" />

            {/* Attendance Rate Banner Card */}
            {loading ? (
              <Card className="block w-full border-black transition-none">
                <Card.Content className="flex items-center justify-center p-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-black" />
                </Card.Content>
              </Card>
            ) : (
              <>
                <Card className="block w-full">
                  <Card.Content className="flex flex-col items-center justify-between gap-6 md:flex-row">
                    <div className="flex w-full items-start justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-20 w-20 items-center justify-center border-2 border-black bg-white text-3xl font-black">
                          {summary?.attendance_rate ?? 100}%
                        </div>
                        <div>
                          <h2 className="text-xl font-bold">
                            Overall Attendance Rate
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            Total Recorded Days:{" "}
                            <span className="font-bold text-black">
                              {summary?.total_days ?? 0}
                            </span>
                          </p>
                        </div>
                      </div>

                      <Badge
                        variant="secondary"
                        size="sm"
                        className="shrink-0 rounded-none border-black font-bold"
                      >
                        {(summary?.attendance_rate ?? 100) >= 90
                          ? "EXCELLENT ATTENDANCE"
                          : (summary?.attendance_rate ?? 100) >= 75
                            ? "GOOD ATTENDANCE"
                            : "AT RISK"}
                      </Badge>
                    </div>
                  </Card.Content>
                </Card>

                {/* Breakdown Cards Grid */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Card className="block w-full">
                    <Card.Content className="flex flex-col items-center">
                      <CheckCircle2 className="mb-1 h-6 w-6 text-emerald-600" />
                      <span className="text-xs font-bold uppercase">
                        Present Days
                      </span>
                      <span className="text-3xl font-black">
                        {summary?.present_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full">
                    <Card.Content className="flex flex-col items-center">
                      <XCircle className="mb-1 h-6 w-6 text-red-600" />
                      <span className="text-xs font-bold uppercase">
                        Absent Days
                      </span>
                      <span className="text-3xl font-black">
                        {summary?.absent_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full">
                    <Card.Content className="flex flex-col items-center">
                      <Clock className="mb-1 h-6 w-6 text-amber-600" />
                      <span className="text-xs font-bold uppercase">
                        Late Days
                      </span>
                      <span className="text-3xl font-black">
                        {summary?.late_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full">
                    <Card.Content className="flex flex-col items-center">
                      <UserCheck className="mb-1 h-6 w-6 text-blue-600" />
                      <span className="text-xs font-bold uppercase">
                        Excused Days
                      </span>
                      <span className="text-3xl font-black">
                        {summary?.excused_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>
                </div>
              </>
            )}

            {/* Leave Request Modal */}
            {showLeaveModal && (
              <Dialog
                open={showLeaveModal}
                onOpenChange={(open) => {
                  if (!open && !submittingLeave) setShowLeaveModal(false);
                }}
              >
                <Dialog.Content
                  size="md"
                  className="border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  overlay={{ className: "bg-black/60" }}
                >
                  <Dialog.Header
                    asChild
                    className="border-b-2 border-black px-5 py-4"
                  >
                    <>
                      <h3 className="text-lg font-bold">
                        Request Leave of Absence
                      </h3>
                      <Dialog.Close
                        title="Close"
                        className="cursor-pointer p-1 font-bold"
                      >
                        <X size={18} />
                      </Dialog.Close>
                    </>
                  </Dialog.Header>

                  <form
                    onSubmit={handleLeaveSubmit}
                    className="flex flex-col gap-3 p-5"
                  >
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase">
                        Start Date
                      </label>
                      <Input
                        type="date"
                        required
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-none border-black text-sm font-bold shadow-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase">
                        End Date
                      </label>
                      <Input
                        type="date"
                        required
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full rounded-none border-black text-sm font-bold shadow-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase">
                        Reason for Absence
                      </label>
                      <textarea
                        required
                        rows={3}
                        placeholder="Medical illness, family emergency..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full border-2 border-black bg-white p-2 text-sm font-medium outline-none focus:border-black"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowLeaveModal(false)}
                        className="border-black font-bold"
                      >
                        Cancel
                      </Button>

                      <Button
                        type="submit"
                        variant="default"
                        size="sm"
                        disabled={submittingLeave}
                        className="gap-1 border-black font-bold"
                      >
                        {submittingLeave ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : leaveSuccess ? (
                          <>
                            <Check className="h-4 w-4 text-emerald-400" />{" "}
                            Submitted!
                          </>
                        ) : (
                          "Submit Request"
                        )}
                      </Button>
                    </div>
                  </form>
                </Dialog.Content>
              </Dialog>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
