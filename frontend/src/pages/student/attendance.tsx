import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
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
  Calendar,
  FileText,
  Loader2,
  Plus,
  Check,
} from "lucide-react";

type ClassOption = {
  class_id: number;
  section_name: string;
};

export default function StudentAttendancePage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [summary, setSummary] = useState<AttendanceSummaryResponse | null>(null);
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
          const classList: ClassOption[] = resClasses.ok ? await resClasses.json() : [];
          setClasses(classList);

          const summaryData = await getStudentAttendanceSummary(user.student_id);
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
            selectedClassId || undefined
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
      <div className="flex flex-col gap-6 p-4 md:p-6 w-full max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-black pb-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                My Attendance & Leave Requests
              </h1>
              <p className="text-sm text-muted-foreground font-medium">
                Track your attendance rate, recorded present/absent days, and submit leave requests.
              </p>
            </div>
          </div>

          <Button
            onClick={() => setShowLeaveModal(true)}
            className="bg-black text-white hover:bg-neutral-800 font-bold text-sm flex items-center gap-2 border-2 border-black"
          >
            <Plus className="w-4 h-4" /> Submit Leave Request
          </Button>
        </div>

        {/* Attendance Rate Banner Card */}
        {loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground border-2 border-black">
            <Loader2 className="w-8 h-8 animate-spin text-black" />
          </div>
        ) : (
          <>
            <Card className="p-6 border-2 border-black bg-neutral-900 text-white shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center text-3xl font-black bg-black">
                  {summary?.attendance_rate ?? 100}%
                </div>
                <div>
                  <h2 className="text-xl font-bold">Overall Attendance Rate</h2>
                  <p className="text-sm text-neutral-300">
                    Total Recorded Days: <span className="font-bold">{summary?.total_days ?? 0}</span>
                  </p>
                  <Badge
                    variant={
                      (summary?.attendance_rate ?? 100) >= 90
                        ? "default"
                        : (summary?.attendance_rate ?? 100) >= 75
                        ? "surface"
                        : "outline"
                    }
                    className="mt-2 font-bold"
                  >
                    {(summary?.attendance_rate ?? 100) >= 90
                      ? "EXCELLENT ATTENDANCE"
                      : (summary?.attendance_rate ?? 100) >= 75
                      ? "GOOD ATTENDANCE"
                      : "AT RISK"}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* Breakdown Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="p-4 border-2 border-black bg-emerald-50 text-emerald-900 flex flex-col items-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mb-1" />
                <span className="text-xs font-bold uppercase">Present Days</span>
                <span className="text-3xl font-black">{summary?.present_count ?? 0}</span>
              </Card>

              <Card className="p-4 border-2 border-black bg-red-50 text-red-900 flex flex-col items-center">
                <XCircle className="w-6 h-6 text-red-600 mb-1" />
                <span className="text-xs font-bold uppercase">Absent Days</span>
                <span className="text-3xl font-black">{summary?.absent_count ?? 0}</span>
              </Card>

              <Card className="p-4 border-2 border-black bg-amber-50 text-amber-900 flex flex-col items-center">
                <Clock className="w-6 h-6 text-amber-600 mb-1" />
                <span className="text-xs font-bold uppercase">Late Days</span>
                <span className="text-3xl font-black">{summary?.late_count ?? 0}</span>
              </Card>

              <Card className="p-4 border-2 border-black bg-blue-50 text-blue-900 flex flex-col items-center">
                <UserCheck className="w-6 h-6 text-blue-600 mb-1" />
                <span className="text-xs font-bold uppercase">Excused Days</span>
                <span className="text-3xl font-black">{summary?.excused_count ?? 0}</span>
              </Card>
            </div>
          </>
        )}

        {/* Leave Request Modal */}
        {showLeaveModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <Card className="p-6 border-2 border-black bg-card max-w-md w-full shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between border-b-2 border-black pb-2">
                <h3 className="text-lg font-bold">Request Leave of Absence</h3>
                <button
                  onClick={() => setShowLeaveModal(false)}
                  className="font-bold p-1 hover:bg-muted"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleLeaveSubmit} className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-bold uppercase block mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full border-2 border-black p-2 text-sm font-bold bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full border-2 border-black p-2 text-sm font-bold bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">
                    Reason for Absence
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Medical illness, family emergency..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full border-2 border-black p-2 text-sm font-medium bg-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t-2 border-black">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowLeaveModal(false)}
                    className="text-xs font-bold border-black"
                  >
                    Cancel
                  </Button>

                  <Button
                    type="submit"
                    disabled={submittingLeave}
                    className="bg-black text-white hover:bg-neutral-800 font-bold text-xs flex items-center gap-1 border-2 border-black"
                  >
                    {submittingLeave ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : leaveSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" /> Submitted!
                      </>
                    ) : (
                      "Submit Request"
                    )}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
