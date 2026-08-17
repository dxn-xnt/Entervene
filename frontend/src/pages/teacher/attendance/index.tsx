import { useEffect, useState, useMemo } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Tabs } from "@/components/retroui/Tabs";
import { Table } from "@/components/retroui/Table";
import { Label } from "@/components/retroui/Label";
import { apiFetch, getTeacherAdvisoryClasses } from "@/lib/api";
import {
  getClassAttendanceLogs,
  recordBatchAttendance,
  getClassLeaveRequests,
  reviewLeaveRequest,
  type AttendanceStatus,
  type LeaveRequestItem,
  type AttendanceRecordItem,
} from "@/lib/attendance-api";
import {
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  Search,
  Save,
  Check,
  X,
  FileText,
  Loader2,
  Users,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type StudentInfo = {
  student_id: string;
  student_lrn?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
};

type ClassItem = {
  class_id: number;
  section_name: string;
  academic_level?: string;
  student_count?: number;
};

type StudentAttendanceState = {
  student_id: string;
  student_name: string;
  student_lrn: string;
  status: AttendanceStatus;
  remarks: string;
};

type StudentSummaryStats = {
  student_id: string;
  student_name: string;
  student_lrn: string;
  total_days: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
  history: AttendanceRecordItem[];
};

export default function TeacherAttendancePage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [activeTab, setActiveTab] = useState<"marking" | "summary" | "leaves">("marking");

  const [studentList, setStudentList] = useState<StudentAttendanceState[]>([]);
  const [allClassLogs, setAllClassLogs] = useState<AttendanceRecordItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [search, setSearch] = useState("");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const attendanceTabs = [
    { id: "marking" as const, label: "Mark attendance", icon: Users },
    { id: "summary" as const, label: "Attendance summary", icon: BarChart3 },
    { id: "leaves" as const, label: "Leave requests", icon: FileText },
  ];

  // Fetch Teacher Classes
  useEffect(() => {
    async function fetchClasses() {
      try {
        setLoadingClasses(true);
        const advisory = await getTeacherAdvisoryClasses();
        const formatted: ClassItem[] = advisory.map((c) => ({
          class_id: c.class_id,
          section_name: c.section_name,
          academic_level: c.academic_level,
          student_count: c.student_count,
        }));
        setClasses(formatted);
        if (formatted.length > 0) {
          setSelectedClassId(formatted[0].class_id);
        }
      } catch (err) {
        console.error("Failed to load advisory classes:", err);
      } finally {
        setLoadingClasses(false);
      }
    }
    fetchClasses();
  }, []);

  // Load Attendance Logs & Students for Selected Class & Date
  useEffect(() => {
    if (!selectedClassId) return;

    async function loadAttendanceData() {
      try {
        setLoadingLogs(true);
        // 1. Fetch class students
        const resStudents = await apiFetch(`/api/v1/classes/${selectedClassId}/students`);
        const rawData = resStudents.ok ? await resStudents.json() : null;
        const students: StudentInfo[] = Array.isArray(rawData)
          ? rawData
          : (rawData?.students || []);

        // 2. Fetch all logs for class (for overall summary matrix)
        const fullLogs = await getClassAttendanceLogs(selectedClassId!);
        setAllClassLogs(fullLogs);

        // 3. Filter logs for selected date for marking view
        const logMap = new Map(
          fullLogs
            .filter((l) => l.date === selectedDate)
            .map((l) => [l.student_id, l])
        );

        // 4. Build marking state array
        const initialStates: StudentAttendanceState[] = students.map((s) => {
          const log = logMap.get(s.student_id);
          const name = s.full_name || `${s.first_name || ""} ${s.last_name || ""}`.trim() || "Student";
          return {
            student_id: s.student_id,
            student_name: name,
            student_lrn: s.student_lrn || "N/A",
            status: (log?.status as AttendanceStatus) || "present",
            remarks: log?.remarks || "",
          };
        });

        setStudentList(initialStates);

        // 5. Fetch leave requests
        const leaves = await getClassLeaveRequests(selectedClassId!);
        setLeaveRequests(leaves);
      } catch (err) {
        console.error("Failed to load attendance logs:", err);
      } finally {
        setLoadingLogs(false);
      }
    }

    loadAttendanceData();
  }, [selectedClassId, selectedDate]);

  // Handle Individual Status Change
  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setStudentList((prev) =>
      prev.map((item) =>
        item.student_id === studentId ? { ...item, status } : item
      )
    );
  };

  // Handle Remarks Change
  const setRemarks = (studentId: string, remarks: string) => {
    setStudentList((prev) =>
      prev.map((item) =>
        item.student_id === studentId ? { ...item, remarks } : item
      )
    );
  };

  // Bulk Actions
  const markAll = (status: AttendanceStatus) => {
    setStudentList((prev) => prev.map((item) => ({ ...item, status })));
  };

  // Save Batch Attendance
  const handleSaveAttendance = async () => {
    if (!selectedClassId) return;
    try {
      setSaving(true);
      await recordBatchAttendance({
        class_id: selectedClassId,
        date: selectedDate,
        records: studentList.map((s) => ({
          student_id: s.student_id,
          status: s.status,
          remarks: s.remarks,
        })),
      });

      // Refresh full logs after saving
      const fullLogs = await getClassAttendanceLogs(selectedClassId);
      setAllClassLogs(fullLogs);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save attendance:", err);
      alert("Error saving attendance records.");
    } finally {
      setSaving(false);
    }
  };

  // Review Leave Request
  const handleReviewLeave = async (leaveId: number, status: "approved" | "rejected") => {
    try {
      const updated = await reviewLeaveRequest(leaveId, status);
      setLeaveRequests((prev) =>
        prev.map((req) => (req.leave_request_id === leaveId ? updated : req))
      );
    } catch (err) {
      console.error("Failed to update leave request:", err);
    }
  };

  // Filtered Students
  const filteredStudents = useMemo(() => {
    if (!search.trim()) return studentList;
    const term = search.toLowerCase();
    return studentList.filter(
      (s) =>
        s.student_name.toLowerCase().includes(term) ||
        s.student_lrn.toLowerCase().includes(term)
    );
  }, [studentList, search]);

  // Overall Class Attendance Summaries Matrix Calculation
  const summaryMatrix = useMemo<StudentSummaryStats[]>(() => {
    const studentMap = new Map<string, StudentSummaryStats>();

    // Initialize all enrolled students
    studentList.forEach((s) => {
      studentMap.set(s.student_id, {
        student_id: s.student_id,
        student_name: s.student_name,
        student_lrn: s.student_lrn,
        total_days: 0,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        rate: 100,
        history: [],
      });
    });

    // Populate from all logs
    allClassLogs.forEach((log) => {
      let stats = studentMap.get(log.student_id);
      if (!stats) {
        stats = {
          student_id: log.student_id,
          student_name: log.student_name || "Student",
          student_lrn: "N/A",
          total_days: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          rate: 100,
          history: [],
        };
        studentMap.set(log.student_id, stats);
      }

      stats.total_days += 1;
      stats.history.push(log);
      if (log.status === "present") stats.present += 1;
      else if (log.status === "absent") stats.absent += 1;
      else if (log.status === "late") stats.late += 1;
      else if (log.status === "excused") stats.excused += 1;
    });

    // Calculate rates
    const list = Array.from(studentMap.values()).map((s) => {
      const attended = s.present + s.late + s.excused;
      const rate = s.total_days > 0 ? Math.round((attended / s.total_days) * 100) : 100;
      return { ...s, rate };
    });

    if (!search.trim()) return list;
    const term = search.toLowerCase();
    return list.filter(
      (s) =>
        s.student_name.toLowerCase().includes(term) ||
        s.student_lrn.toLowerCase().includes(term)
    );
  }, [allClassLogs, studentList, search]);

  // Statistics for Marking View
  const stats = useMemo(() => {
    const total = studentList.length;
    const present = studentList.filter((s) => s.status === "present").length;
    const absent = studentList.filter((s) => s.status === "absent").length;
    const late = studentList.filter((s) => s.status === "late").length;
    const excused = studentList.filter((s) => s.status === "excused").length;
    const rate = total > 0 ? Math.round(((present + late + excused) / total) * 100) : 100;
    return { total, present, absent, late, excused, rate };
  }, [studentList]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <div>
                <h1 className="text-2xl font-bold md:text-4xl">Class attendance</h1>
              </div>
            </header>

            <Tabs
              tabs={attendanceTabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              counts={{ leaves: leaveRequests.filter((l) => l.status === "pending").length }}
            />

        {/* Filters & Control Bar */}
        <Card className="block border-border p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-center">
            {/* Class Selector */}
            <div>
              <Label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Select class</Label>
              {loadingClasses ? (
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading classes...
                </div>
              ) : (
                <select
                  className="h-10 w-full rounded border-2 border-input bg-background px-3 text-sm font-semibold shadow-md outline-none focus:shadow-none"
                  value={selectedClassId || ""}
                  onChange={(e) => setSelectedClassId(Number(e.target.value))}
                >
                  {classes.map((c) => (
                    <option key={c.class_id} value={c.class_id}>
                      {c.section_name} ({c.academic_level || "Class"})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Date Selector (Only shown for Marking tab) */}
            {activeTab === "marking" && (
              <div>
                <Label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Attendance date</Label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-10 w-full bg-background text-sm font-semibold"
                />
              </div>
            )}

            {/* Search */}
            <div className={activeTab !== "marking" ? "sm:col-span-2" : ""}>
              <Label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Search student</Label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search name or LRN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full bg-background pl-9 text-sm"
                />
              </div>
            </div>
          </div>
        </Card>

        {activeTab === "marking" ? (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Card className="flex w-full flex-col items-center justify-center border-border bg-card p-2.5">
                <div className="flex items-center gap-1 text-xs font-bold uppercase">
                  <CheckCircle2 className="w-4 h-4" /> Present
                </div>
                <span className="text-2xl font-black">{stats.present}</span>
              </Card>

              <Card className="flex w-full flex-col items-center justify-center border-border bg-card p-2.5">
                <div className="flex items-center gap-1 text-xs font-bold uppercase">
                  <XCircle className="w-4 h-4" /> Absent
                </div>
                <span className="text-2xl font-black">{stats.absent}</span>
              </Card>

              <Card className="flex w-full flex-col items-center justify-center border-border bg-card p-2.5">
                <div className="flex items-center gap-1 text-xs font-bold uppercase">
                  <Clock className="w-4 h-4" /> Late
                </div>
                <span className="text-2xl font-black">{stats.late}</span>
              </Card>

              <Card className="flex w-full flex-col items-center justify-center border-border bg-card p-2.5">
                <div className="flex items-center gap-1 text-xs font-bold uppercase">
                  <UserCheck className="w-4 h-4" /> Excused
                </div>
                <span className="text-2xl font-black">{stats.excused}</span>
              </Card>

              <Card className="col-span-2 flex w-full flex-col items-center justify-center border-border bg-card p-2.5 sm:col-span-1">
                <div className="text-xs font-bold uppercase text-muted-foreground">
                  Daily Rate
                </div>
                <span className="text-2xl font-black">{stats.rate}%</span>
              </Card>
            </div>

            {/* Quick Bulk Actions & Save Bar */}
            <Card className="flex w-full flex-wrap items-center justify-between gap-3  p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-muted-foreground mr-1">
                  Bulk Mark:
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => markAll("present")}
                  className="text-xs font-bold bg-emerald-100 hover:bg-emerald-200 border-black"
                >
                  All Present
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => markAll("absent")}
                  className="text-xs font-bold bg-red-100 hover:bg-red-200 border-black"
                >
                  All Absent
                </Button>
              </div>

              <Button
                onClick={handleSaveAttendance}
                disabled={saving || studentList.length === 0}
                className=" flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" /> Saved Successfully!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" /> Save Attendance Log
                  </>
                )}
              </Button>
            </Card>

            {/* Attendance Roster Table */}
            {loadingLogs ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-black">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-black" />
                <p className="font-semibold">Loading student roster...</p>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-black bg-card">
                <Users className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-lg font-bold">No students found</p>
                <p className="text-sm">Select a valid class or clear search term.</p>
              </div>
            ) : (
              <Table wrapperClassName="overflow-x-auto" className="min-w-[850px] border-collapse bg-card">
                  <Table.Header>
                    <Table.Row className="hover:bg-primary hover:text-primary-foreground">
                      <th className="p-3 border-r-2 border-black">#</th>
                      <th className="p-3 border-r-2 border-black">LRN</th>
                      <th className="p-3 border-r-2 border-black">Student Name</th>
                      <th className="p-3 border-r-2 border-black text-center">Status</th>
                      <th className="p-3">Remarks / Reason</th>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body className="text-sm">
                    {filteredStudents.map((student, index) => (
                      <tr
                        key={student.student_id}
                        className={`hover:bg-muted/30 transition-colors ${
                          student.status === "absent"
                            ? "bg-red-50/50"
                            : student.status === "late"
                            ? "bg-amber-50/50"
                            : student.status === "excused"
                            ? "bg-blue-50/50"
                            : ""
                        }`}
                      >
                        <td className="p-3 font-bold text-xs border-r-2 border-black text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="p-3 font-mono text-xs font-semibold border-r-2 border-black">
                          {student.student_lrn}
                        </td>
                        <td className="p-3 font-bold border-r-2 border-black">
                          {student.student_name}
                        </td>

                        {/* Status Radio Buttons */}
                        <td className="p-3 border-r-2 border-black">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setStatus(student.student_id, "present")}
                              className={`px-3 py-1 text-xs font-bold border border-black rounded-none transition-all ${
                                student.status === "present"
                                  ? "bg-emerald-600 text-white shadow-sm scale-105"
                                  : "bg-white text-emerald-800 hover:bg-emerald-50"
                              }`}
                            >
                              Present
                            </button>

                            <button
                              type="button"
                              onClick={() => setStatus(student.student_id, "absent")}
                              className={`px-3 py-1 text-xs font-bold border border-black rounded-none transition-all ${
                                student.status === "absent"
                                  ? "bg-red-600 text-white shadow-sm scale-105"
                                  : "bg-white text-red-800 hover:bg-red-50"
                              }`}
                            >
                              Absent
                            </button>

                            <button
                              type="button"
                              onClick={() => setStatus(student.student_id, "late")}
                              className={`px-3 py-1 text-xs font-bold border border-black rounded-none transition-all ${
                                student.status === "late"
                                  ? "bg-amber-500 text-black shadow-sm scale-105"
                                  : "bg-white text-amber-800 hover:bg-amber-50"
                              }`}
                            >
                              Late
                            </button>

                            <button
                              type="button"
                              onClick={() => setStatus(student.student_id, "excused")}
                              className={`px-3 py-1 text-xs font-bold border border-black rounded-none transition-all ${
                                student.status === "excused"
                                  ? "bg-blue-600 text-white shadow-sm scale-105"
                                  : "bg-white text-blue-800 hover:bg-blue-50"
                              }`}
                            >
                              Excused
                            </button>
                          </div>
                        </td>

                        {/* Remarks Input */}
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="Add optional note..."
                            value={student.remarks}
                            onChange={(e) => setRemarks(student.student_id, e.target.value)}
                            className="w-full text-xs font-medium p-1.5 border border-neutral-300 rounded-none focus:border-black focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </Table.Body>
              </Table>
            )}
          </>
        ) : activeTab === "summary" ? (
          /* Attendance Summary & Report Matrix */
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">Class Attendance Report Matrix</h2>
                <p className="text-xs text-muted-foreground font-semibold">
                  Overall attendance rates and total recorded days per student across the school term.
                </p>
              </div>
            </div>

            {loadingLogs ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-black">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-black" />
                <p className="font-semibold">Calculating attendance summaries...</p>
              </div>
            ) : summaryMatrix.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-black bg-card">
                <BarChart3 className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-lg font-bold">No attendance records found</p>
                <p className="text-sm">Mark attendance for this class to populate the summary report.</p>
              </div>
            ) : (
              <Table wrapperClassName="overflow-x-auto" className="min-w-[950px] border-collapse bg-card">
                  <Table.Header>
                    <Table.Row className="hover:bg-primary hover:text-primary-foreground">
                      <th className="p-3 border-r-2 border-black">#</th>
                      <th className="p-3 border-r-2 border-black">Student Name</th>
                      <th className="p-3 border-r-2 border-black text-center">Total Days</th>
                      <th className="p-3 border-r-2 border-black text-center text-emerald-800">Present</th>
                      <th className="p-3 border-r-2 border-black text-center text-red-800">Absent</th>
                      <th className="p-3 border-r-2 border-black text-center text-amber-800">Late</th>
                      <th className="p-3 border-r-2 border-black text-center text-blue-800">Excused</th>
                      <th className="p-3 border-r-2 border-black text-center">Attendance Rate</th>
                      <th className="p-3 text-center">History</th>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body className="text-sm">
                    {summaryMatrix.map((item, index) => {
                      const isExpanded = expandedStudentId === item.student_id;
                      return (
                        <tr key={item.student_id} className="group hover:bg-muted/20">
                          <td className="p-3 font-bold text-xs border-r-2 border-black text-muted-foreground">
                            {index + 1}
                          </td>
                          <td className="p-3 font-bold border-r-2 border-black">
                            {item.student_name}
                          </td>
                          <td className="p-3 font-semibold text-center border-r-2 border-black">
                            {item.total_days}
                          </td>
                          <td className="p-3 font-bold text-center border-r-2 border-black text-emerald-700 bg-emerald-50/30">
                            {item.present}
                          </td>
                          <td className="p-3 font-bold text-center border-r-2 border-black text-red-700 bg-red-50/30">
                            {item.absent}
                          </td>
                          <td className="p-3 font-bold text-center border-r-2 border-black text-amber-700 bg-amber-50/30">
                            {item.late}
                          </td>
                          <td className="p-3 font-bold text-center border-r-2 border-black text-blue-700 bg-blue-50/30">
                            {item.excused}
                          </td>
                          <td className="p-3 text-center border-r-2 border-black">
                            <Badge
                              variant={
                                item.rate >= 90
                                  ? "default"
                                  : item.rate >= 75
                                  ? "surface"
                                  : "outline"
                              }
                              className={
                                item.rate < 75 ? "border-red-600 bg-red-100 text-red-900 font-bold" : "font-bold"
                              }
                            >
                              {item.rate}%
                            </Badge>
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() =>
                                setExpandedStudentId(isExpanded ? null : item.student_id)
                              }
                              className="text-xs font-bold flex items-center justify-center gap-1 mx-auto hover:underline"
                            >
                              {isExpanded ? "Hide" : "View"} Logs
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </Table.Body>
              </Table>
            )}
          </div>
        ) : (
          /* Leave Requests Section */
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">Student Leave Requests</h2>
            {leaveRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-black bg-card">
                <FileText className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-lg font-bold">No leave requests</p>
                <p className="text-sm">No leave requests have been submitted for this class.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {leaveRequests.map((req) => (
                  <Card
                    key={req.leave_request_id}
                    className="p-4 border-2 border-black bg-card shadow-md flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-extrabold text-base">
                          {req.student_name || "Student"}
                        </h3>
                        <p className="text-xs text-muted-foreground font-semibold">
                          <Calendar className="w-3.5 h-3.5 inline mr-1" />
                          {req.start_date} to {req.end_date}
                        </p>
                      </div>
                      <Badge
                        variant={
                          req.status === "approved"
                            ? "default"
                            : req.status === "rejected"
                            ? "outline"
                            : "surface"
                        }
                      >
                        {req.status.toUpperCase()}
                      </Badge>
                    </div>

                    <div className="bg-muted/50 p-2 border border-black text-xs font-medium">
                      <span className="font-bold block mb-0.5">Reason:</span>
                      {req.reason}
                    </div>

                    {req.status === "pending" && (
                      <div className="flex items-center gap-2 pt-2 border-t border-neutral-200">
                        <Button
                          size="sm"
                          onClick={() => handleReviewLeave(req.leave_request_id, "approved")}
                          className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-xs flex-1 flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReviewLeave(req.leave_request_id, "rejected")}
                          className="bg-red-100 text-red-800 hover:bg-red-200 border-black font-bold text-xs flex-1 flex items-center justify-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
