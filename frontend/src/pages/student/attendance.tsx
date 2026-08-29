import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { Table } from "@/components/retroui/Table";
import { apiFetch, getMyClass, type StudentMyClassSummary } from "@/lib/api";
import {
  getMyAttendanceSummary,
  getMyAttendanceLogs,
  getMyLeaveRequests,
  submitLeaveRequest,
  type AttendanceSummaryResponse,
  type AttendanceRecordItem,
  type LeaveRequestItem,
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
  FileText,
  Calendar,
  BookOpen,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";

type SubjectOption = {
  subject_id: number;
  subject_name: string;
  teacher_name?: string;
};

export default function StudentAttendancePage() {
  const [myClass, setMyClass] = useState<StudentMyClassSummary | null>(null);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | "all">("all");

  const [summary, setSummary] = useState<AttendanceSummaryResponse | null>(null);
  const [logs, setLogs] = useState<AttendanceRecordItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"logs" | "leaves">("logs");

  // Leave request modal state
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveSuccess, setLeaveSuccess] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  // Load class info and subjects list once
  useEffect(() => {
    async function loadMeta() {
      try {
        const [classData, resSubjects] = await Promise.all([
          getMyClass().catch(() => null),
          apiFetch("/api/v1/students/me/subjects").catch(() => null),
        ]);
        setMyClass(classData);

        if (resSubjects && resSubjects.ok) {
          const subjectsData = await resSubjects.json();
          setSubjects(
            subjectsData.map((s: { subject_id: number; subject_name: string; teacher_name?: string }) => ({
              subject_id: s.subject_id,
              subject_name: s.subject_name,
              teacher_name: s.teacher_name,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to load attendance metadata:", err);
      }
    }
    loadMeta();
  }, []);

  // Load attendance data whenever selectedSubjectId changes
  const loadAttendanceData = async () => {
    try {
      setLoading(true);
      setError("");

      const subjectFilter = selectedSubjectId === "all" ? undefined : selectedSubjectId;

      const [summaryData, logsData, leavesData] = await Promise.all([
        getMyAttendanceSummary(undefined, subjectFilter).catch(() => null),
        getMyAttendanceLogs(undefined, subjectFilter).catch(() => []),
        getMyLeaveRequests().catch(() => []),
      ]);

      setSummary(summaryData);
      setLogs(logsData);
      setLeaveRequests(leavesData);
    } catch (err) {
      console.error("Failed to load student attendance:", err);
      setError("Unable to load attendance data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendanceData();
  }, [selectedSubjectId]);

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myClass?.class_id) {
      setLeaveError("You are not enrolled in an active class.");
      return;
    }

    try {
      setSubmittingLeave(true);
      setLeaveError("");
      await submitLeaveRequest({
        class_id: myClass.class_id,
        start_date: startDate,
        end_date: endDate,
        reason: reason,
      });

      setLeaveSuccess(true);
      setTimeout(() => {
        setLeaveSuccess(false);
        setShowLeaveModal(false);
        setStartDate("");
        setEndDate("");
        setReason("");
        loadAttendanceData();
      }, 1500);
    } catch (err) {
      console.error("Failed to submit leave request:", err);
      setLeaveError(err instanceof Error ? err.message : "Error submitting leave request.");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "present":
        return (
          <Badge variant="surface" className="bg-emerald-100 text-emerald-800 border-emerald-400 font-bold">
            Present
          </Badge>
        );
      case "absent":
        return (
          <Badge variant="surface" className="bg-red-100 text-red-800 border-red-400 font-bold">
            Absent
          </Badge>
        );
      case "late":
        return (
          <Badge variant="surface" className="bg-amber-100 text-amber-800 border-amber-400 font-bold">
            Late
          </Badge>
        );
      case "excused":
        return (
          <Badge variant="surface" className="bg-blue-100 text-blue-800 border-blue-400 font-bold">
            Excused
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="capitalize font-bold">
            {status}
          </Badge>
        );
    }
  };

  const getLeaveStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "approved":
        return (
          <Badge variant="surface" className="bg-emerald-100 text-emerald-800 border-emerald-400 font-bold">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="surface" className="bg-red-100 text-red-800 border-red-400 font-bold">
            Rejected
          </Badge>
        );
      case "pending":
      default:
        return (
          <Badge variant="surface" className="bg-amber-100 text-amber-800 border-amber-400 font-bold">
            Pending Review
          </Badge>
        );
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
            {/* Header */}
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                    My Attendance & Leave Requests
                  </h1>
                  {myClass && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {myClass.grade_level} - {myClass.section_name} ({myClass.academic_year})
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="md"
                  onClick={() => setShowLeaveModal(true)}
                  className="gap-2 whitespace-nowrap"
                >
                  <Plus className="size-4" /> Submit Leave Request
                </Button>
              </div>
            </header>

            <div className="-mx-4 -mt-[1px] border-b-2 border-border md:-mx-6" />

            {/* Subject Selector Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-50 border-2 border-black p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-black/70" />
                <span className="text-xs font-bold uppercase tracking-wider">Attendance Scope:</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedSubjectId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedSubjectId(val === "all" ? "all" : Number(val));
                  }}
                  className="border-2 border-black bg-white px-3 py-1 text-xs font-bold cursor-pointer focus:outline-none"
                >
                  <option value="all">Overall / All Subjects</option>
                  {subjects.map((sub) => (
                    <option key={sub.subject_id} value={sub.subject_id}>
                      {sub.subject_name} {sub.teacher_name ? `(${sub.teacher_name})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Attendance Rate Banner Card */}
            {loading ? (
              <LoadingPanel label="Loading attendance records..." />
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-red-500 gap-2">
                <p className="text-sm font-semibold">{error}</p>
                <Button onClick={loadAttendanceData} size="sm">
                  Retry
                </Button>
              </div>
            ) : (
              <>
                <Card className="block w-full">
                  <Card.Content className="flex flex-col items-center justify-between gap-6 md:flex-row">
                    <div className="flex w-full items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-20 w-20 items-center justify-center border-2 border-black bg-[#F6E9B2] text-3xl font-black shadow-sm">
                          {summary?.attendance_rate ?? 100}%
                        </div>
                        <div>
                          <h2 className="text-xl font-bold">
                            {selectedSubjectId === "all"
                              ? "Overall Attendance Rate"
                              : `${subjects.find((s) => s.subject_id === selectedSubjectId)?.subject_name ?? "Subject"} Attendance Rate`}
                          </h2>
                          <p className="text-sm text-muted-foreground mt-1">
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
                        className="shrink-0 rounded-none border-black font-bold px-3 py-1"
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
                  <Card className="block w-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <Card.Content className="flex flex-col items-center p-5">
                      <CheckCircle2 className="mb-1 h-6 w-6 text-emerald-600" />
                      <span className="text-xs font-bold uppercase text-muted-foreground">
                        Present Days
                      </span>
                      <span className="text-3xl font-black mt-1">
                        {summary?.present_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <Card.Content className="flex flex-col items-center p-5">
                      <XCircle className="mb-1 h-6 w-6 text-red-600" />
                      <span className="text-xs font-bold uppercase text-muted-foreground">
                        Absent Days
                      </span>
                      <span className="text-3xl font-black mt-1">
                        {summary?.absent_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <Card.Content className="flex flex-col items-center p-5">
                      <Clock className="mb-1 h-6 w-6 text-amber-600" />
                      <span className="text-xs font-bold uppercase text-muted-foreground">
                        Late Days
                      </span>
                      <span className="text-3xl font-black mt-1">
                        {summary?.late_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <Card.Content className="flex flex-col items-center p-5">
                      <UserCheck className="mb-1 h-6 w-6 text-blue-600" />
                      <span className="text-xs font-bold uppercase text-muted-foreground">
                        Excused Days
                      </span>
                      <span className="text-3xl font-black mt-1">
                        {summary?.excused_count ?? 0}
                      </span>
                    </Card.Content>
                  </Card>
                </div>

                {/* Tab Controls for Logs vs Leave Requests */}
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 border-b-2 border-black pb-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("logs")}
                      className={`px-4 py-2 text-sm font-bold border-2 border-black transition-all cursor-pointer ${activeTab === "logs"
                        ? "bg-black text-white shadow-none"
                        : "bg-white text-black hover:bg-neutral-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        }`}
                    >
                      <Calendar className="w-4 h-4 inline mr-2" />
                      Attendance History ({logs.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("leaves")}
                      className={`px-4 py-2 text-sm font-bold border-2 border-black transition-all cursor-pointer ${activeTab === "leaves"
                        ? "bg-black text-white shadow-none"
                        : "bg-white text-black hover:bg-neutral-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        }`}
                    >
                      <FileText className="w-4 h-4 inline mr-2" />
                      Leave Requests ({leaveRequests.length})
                    </button>
                  </div>

                  {/* Tab Content: Logs */}
                  {activeTab === "logs" && (
                    <div className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                      {logs.length === 0 ? (
                        <EmptyStateCard
                          title="No attendance records found"
                          description={
                            selectedSubjectId === "all"
                              ? "Daily attendance marked by your teachers will appear here."
                              : "No attendance recorded for this specific subject."
                          }
                          className="border-0 shadow-none"
                        />
                      ) : (
                        <Table wrapperClassName="overflow-x-auto" className="min-w-full border-collapse">
                          <Table.Header>
                            <Table.Row className="bg-neutral-100">
                              <th className="p-3 border-r-2 border-black text-left text-xs font-extrabold uppercase">#</th>
                              <th className="p-3 border-r-2 border-black text-left text-xs font-extrabold uppercase">Date</th>
                              <th className="p-3 border-r-2 border-black text-left text-xs font-extrabold uppercase">Subject</th>
                              <th className="p-3 border-r-2 border-black text-center text-xs font-extrabold uppercase">Status</th>
                              <th className="p-3 text-left text-xs font-extrabold uppercase">Remarks / Notes</th>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body className="text-sm">
                            {logs.map((log, index) => (
                              <tr key={log.attendance_id || index} className="border-t-2 border-black hover:bg-neutral-50">
                                <td className="p-3 font-bold text-xs border-r-2 border-black text-muted-foreground">
                                  {index + 1}
                                </td>
                                <td className="p-3 font-semibold border-r-2 border-black">
                                  {new Date(log.date).toLocaleDateString(undefined, {
                                    weekday: "short",
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </td>
                                <td className="p-3 border-r-2 border-black text-xs font-bold text-black/80">
                                  {log.subject_name || "Daily Homeroom"}
                                </td>
                                <td className="p-3 border-r-2 border-black text-center">
                                  {getStatusBadge(log.status)}
                                </td>
                                <td className="p-3 text-xs text-muted-foreground">
                                  {log.remarks || "—"}
                                </td>
                              </tr>
                            ))}
                          </Table.Body>
                        </Table>
                      )}
                    </div>
                  )}

                  {/* Tab Content: Leave Requests */}
                  {activeTab === "leaves" && (
                    <div className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                      {leaveRequests.length === 0 ? (
                        <div className="px-6 py-12 text-center text-muted-foreground">
                          <p className="text-base font-bold">No leave requests submitted</p>
                          <p className="mt-1 text-sm font-normal text-gray-500">Submit a leave request if you plan to be absent.</p>
                        </div>
                      ) : (
                        <Table wrapperClassName="overflow-x-auto" className="min-w-full border-collapse">
                          <Table.Header>
                            <Table.Row className="bg-neutral-100">
                              <th className="p-3 border-r-2 border-black text-left text-xs font-extrabold uppercase">#</th>
                              <th className="p-3 border-r-2 border-black text-left text-xs font-extrabold uppercase">Dates</th>
                              <th className="p-3 border-r-2 border-black text-left text-xs font-extrabold uppercase">Reason</th>
                              <th className="p-3 border-r-2 border-black text-center text-xs font-extrabold uppercase">Status</th>
                              <th className="p-3 text-left text-xs font-extrabold uppercase">Date Submitted</th>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body className="text-sm">
                            {leaveRequests.map((req, index) => (
                              <tr key={req.leave_request_id || index} className="border-t-2 border-black hover:bg-neutral-50">
                                <td className="p-3 font-bold text-xs border-r-2 border-black text-muted-foreground">
                                  {index + 1}
                                </td>
                                <td className="p-3 font-semibold border-r-2 border-black text-xs">
                                  {req.start_date} to {req.end_date}
                                </td>
                                <td className="p-3 border-r-2 border-black text-xs font-medium">
                                  {req.reason}
                                </td>
                                <td className="p-3 border-r-2 border-black text-center">
                                  {getLeaveStatusBadge(req.status)}
                                </td>
                                <td className="p-3 text-xs text-muted-foreground">
                                  {req.created_at ? new Date(req.created_at).toLocaleDateString() : "—"}
                                </td>
                              </tr>
                            ))}
                          </Table.Body>
                        </Table>
                      )}
                    </div>
                  )}
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
                  className="border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  overlay={{ className: "bg-black/60" }}
                >
                  <Dialog.Header
                    asChild
                    className="border-b-2 border-black px-5 py-4 bg-primary"
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
                    {leaveError && (
                      <div className="border-2 border-red-500 bg-red-50 p-2 text-xs font-bold text-red-700">
                        {leaveError}
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase">
                        Start Date
                      </label>
                      <Input
                        type="date"
                        required
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-none border-2 border-black text-sm font-bold shadow-none"
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
                        className="w-full rounded-none border-2 border-black text-sm font-bold shadow-none"
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
                        className="w-full border-2 border-black bg-white p-2 text-sm font-medium outline-none focus:border-black resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowLeaveModal(false)}
                        className="border-2 border-black font-bold cursor-pointer"
                      >
                        Cancel
                      </Button>

                      <Button
                        type="submit"
                        variant="default"
                        size="sm"
                        disabled={submittingLeave}
                        className="gap-1 border-2 border-black font-bold cursor-pointer"
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
