import { useEffect, useState, useMemo, Fragment } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
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
  Table as TableIcon,
  ListFilter,
  Eye,
  EyeOff,
} from "lucide-react";

type StudentInfo = {
  student_id: string;
  student_lrn?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
};

type AttendanceTarget = {
  key: string;
  class_id: number;
  subject_id?: number;
  section_name: string;
  subject_name?: string;
  academic_level?: string;
  label: string;
  is_advisory: boolean;
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
  logByDate: Map<string, AttendanceRecordItem>;
};

export default function TeacherAttendancePage() {
  const [targets, setTargets] = useState<AttendanceTarget[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [activeTab, setActiveTab] = useState<"marking" | "summary" | "leaves">(
    "marking",
  );

  // Summary View Options
  const [summaryLayout, setSummaryLayout] = useState<"summary" | "date_grid">(
    "summary",
  );
  const [expandAll, setExpandAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "absent" | "late" | "excused"
  >("all");

  const [studentList, setStudentList] = useState<StudentAttendanceState[]>([]);
  const [allClassLogs, setAllClassLogs] = useState<AttendanceRecordItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [search, setSearch] = useState("");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(
    null,
  );

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.key === selectedTargetKey) || targets[0] || null,
    [targets, selectedTargetKey],
  );
  const selectedClassId = selectedTarget?.class_id || null;
  const selectedSubjectId = selectedTarget?.subject_id || undefined;

  const advisoryTargets = useMemo(
    () => targets.filter((t) => t.is_advisory),
    [targets],
  );
  const subjectTargets = useMemo(
    () => targets.filter((t) => !t.is_advisory),
    [targets],
  );

  // Fetch Teacher Advisory Classes and Subject Teaching Classes
  useEffect(() => {
    async function fetchClasses() {
      try {
        setLoadingClasses(true);
        const [advisoryRes, loadsRes] = await Promise.all([
          getTeacherAdvisoryClasses(),
          apiFetch("/api/v1/classwork-assignments/teacher/classes"),
        ]);

        const list: AttendanceTarget[] = [];

        // 1. Advisory classes (Homeroom / Daily)
        advisoryRes.forEach((c) => {
          list.push({
            key: `adv-${c.class_id}`,
            class_id: c.class_id,
            section_name: c.section_name,
            academic_level: c.academic_level,
            label: `${c.section_name} (${c.academic_level || "Advisory"})`,
            is_advisory: true,
          });
        });

        // 2. Subject Teaching Loads
        if (loadsRes.ok) {
          const loads = (await loadsRes.json()) as Array<{
            subject_load_id: number;
            subject_id: number;
            subject_name: string;
            class_id: number;
            section_name: string;
            grade_level?: string;
          }>;
          loads.forEach((l) => {
            list.push({
              key: `subj-${l.class_id}-${l.subject_id}`,
              class_id: l.class_id,
              subject_id: l.subject_id,
              section_name: l.section_name,
              subject_name: l.subject_name,
              academic_level: l.grade_level,
              label: `${l.subject_name} • ${l.section_name} (${l.grade_level || "Subject"})`,
              is_advisory: false,
            });
          });
        }

        setTargets(list);
        if (list.length > 0) {
          setSelectedTargetKey(list[0].key);
        }
      } catch (err) {
        console.error("Failed to load attendance classes:", err);
      } finally {
        setLoadingClasses(false);
      }
    }
    fetchClasses();
  }, []);

  // Load Attendance Logs & Students for Selected Class & Subject & Date
  useEffect(() => {
    if (!selectedClassId) return;

    async function loadAttendanceData() {
      try {
        setLoadingLogs(true);
        // 1. Fetch class students
        const resStudents = await apiFetch(
          `/api/v1/classes/${selectedClassId}/students`,
        );
        const rawData = resStudents.ok ? await resStudents.json() : null;
        const students: StudentInfo[] = Array.isArray(rawData)
          ? rawData
          : rawData?.students || [];

        // 2. Fetch all logs for class & subject
        const fullLogs = await getClassAttendanceLogs(
          selectedClassId!,
          undefined,
          selectedSubjectId,
        );
        setAllClassLogs(fullLogs);

        // 3. Filter logs for selected date for marking view
        const logMap = new Map(
          fullLogs
            .filter((l) => l.date === selectedDate)
            .map((l) => [l.student_id, l]),
        );

        // 4. Build marking state array
        const initialStates: StudentAttendanceState[] = students.map((s) => {
          const log = logMap.get(s.student_id);
          const name =
            s.full_name ||
            `${s.first_name || ""} ${s.last_name || ""}`.trim() ||
            "Student";
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
        const leaves = await getClassLeaveRequests(
          selectedClassId!,
          selectedSubjectId,
        );
        setLeaveRequests(leaves);
      } catch (err) {
        console.error("Failed to load attendance logs:", err);
      } finally {
        setLoadingLogs(false);
      }
    }

    loadAttendanceData();
  }, [selectedClassId, selectedSubjectId, selectedDate]);

  // Unique recorded dates sorted chronologically
  const uniqueDates = useMemo(() => {
    const set = new Set<string>();
    allClassLogs.forEach((l) => set.add(l.date));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allClassLogs]);

  // Handle Individual Status Change
  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setStudentList((prev) =>
      prev.map((item) =>
        item.student_id === studentId ? { ...item, status } : item,
      ),
    );
  };

  // Handle Remarks Change
  const setRemarks = (studentId: string, remarks: string) => {
    setStudentList((prev) =>
      prev.map((item) =>
        item.student_id === studentId ? { ...item, remarks } : item,
      ),
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
        subject_id: selectedSubjectId,
        date: selectedDate,
        records: studentList.map((s) => ({
          student_id: s.student_id,
          status: s.status,
          remarks: s.remarks,
        })),
      });

      // Refresh full logs after saving
      const fullLogs = await getClassAttendanceLogs(
        selectedClassId,
        undefined,
        selectedSubjectId,
      );
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
  const handleReviewLeave = async (
    leaveId: number,
    status: "approved" | "rejected",
  ) => {
    try {
      const updated = await reviewLeaveRequest(leaveId, status);
      setLeaveRequests((prev) =>
        prev.map((req) => (req.leave_request_id === leaveId ? updated : req)),
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
        s.student_lrn.toLowerCase().includes(term),
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
        logByDate: new Map(),
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
          logByDate: new Map(),
        };
        studentMap.set(log.student_id, stats);
      }

      stats.total_days += 1;
      stats.history.push(log);
      stats.logByDate.set(log.date, log);

      if (log.status === "present") stats.present += 1;
      else if (log.status === "absent") stats.absent += 1;
      else if (log.status === "late") stats.late += 1;
      else if (log.status === "excused") stats.excused += 1;
    });

    // Calculate rates
    let list = Array.from(studentMap.values()).map((s) => {
      const attended = s.present + s.late + s.excused;
      const rate =
        s.total_days > 0 ? Math.round((attended / s.total_days) * 100) : 100;
      return { ...s, rate };
    });

    // Filter by Status if active
    if (statusFilter === "absent") list = list.filter((s) => s.absent > 0);
    else if (statusFilter === "late") list = list.filter((s) => s.late > 0);
    else if (statusFilter === "excused")
      list = list.filter((s) => s.excused > 0);

    // Search filter
    if (!search.trim()) return list;
    const term = search.toLowerCase();
    return list.filter(
      (s) =>
        s.student_name.toLowerCase().includes(term) ||
        s.student_lrn.toLowerCase().includes(term),
    );
  }, [allClassLogs, studentList, search, statusFilter]);

  // Statistics for Marking View
  const stats = useMemo(() => {
    const total = studentList.length;
    const present = studentList.filter((s) => s.status === "present").length;
    const absent = studentList.filter((s) => s.status === "absent").length;
    const late = studentList.filter((s) => s.status === "late").length;
    const excused = studentList.filter((s) => s.status === "excused").length;
    const rate =
      total > 0 ? Math.round(((present + late + excused) / total) * 100) : 100;
    return { total, present, absent, late, excused, rate };
  }, [studentList]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-bold">Attendance</h1>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant={activeTab === "marking" ? "default" : "outline"}
                  onClick={() => setActiveTab("marking")}
                  className="text-xs md:text-sm"
                >
                  <Users className="w-4 h-4 mr-1.5" />
                  Mark Attendance
                </Button>

                <Button
                  variant={activeTab === "summary" ? "default" : "outline"}
                  onClick={() => setActiveTab("summary")}
                  className="text-xs md:text-sm"
                >
                  <BarChart3 className="w-4 h-4 mr-1.5" />
                  Attendance Summary & Logs
                </Button>

                <Button
                  variant={activeTab === "leaves" ? "default" : "outline"}
                  onClick={() => setActiveTab("leaves")}
                  className="text-xs md:text-sm relative"
                >
                  <FileText className="w-4 h-4 mr-1.5" />
                  Leave Requests
                  {leaveRequests.filter((l) => l.status === "pending").length >
                    0 && (
                    <Badge
                      variant="solid"
                      size="sm"
                      className="ml-2 rounded-none border-black bg-red-500 text-white"
                    >
                      {
                        leaveRequests.filter((l) => l.status === "pending")
                          .length
                      }
                    </Badge>
                  )}
                </Button>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            {/* Filters & Control Bar */}
            <Card className="block w-full border-black bg-white p-5 transition-none">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-center">
                {/* Class Selector */}
                <div>
                  <Label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
                    Select class / subject
                  </Label>
                  {loadingClasses ? (
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading
                      classes...
                    </div>
                  ) : (
                    <select
                      className="h-10 w-full rounded-none border-2 border-black bg-white px-3 text-sm font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] outline-none transition-none focus:shadow-none"
                      value={selectedTargetKey}
                      onChange={(e) => setSelectedTargetKey(e.target.value)}
                    >
                      {advisoryTargets.length > 0 && (
                        <optgroup label="Advisory Classes (Homeroom Attendance)">
                          {advisoryTargets.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {subjectTargets.length > 0 && (
                        <optgroup label="Subject Teaching Classes">
                          {subjectTargets.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  )}
                </div>

                {/* Date Selector (Only shown for Marking tab) */}
                {activeTab === "marking" && (
                  <div>
                    <Label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
                      Attendance date
                    </Label>
                    <Input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="rounded-none border-black !shadow-none h-10 w-full bg-white text-sm font-semibold"
                    />
                  </div>
                )}

                {/* Search */}
                <div className={activeTab !== "marking" ? "sm:col-span-2" : ""}>
                  <Label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
                    Search student
                  </Label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
                    <Input
                      type="text"
                      placeholder="Search name or LRN..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="rounded-none border-black !shadow-none h-10 w-full bg-white pl-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            </Card>

            {activeTab === "marking" ? (
              <>
                {/* Stats Overview */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Card className="flex w-full flex-col items-center justify-center border-black bg-white p-2.5 transition-none">
                    <div className="flex items-center gap-1 text-xs font-bold uppercase">
                      <CheckCircle2 className="w-4 h-4" /> Present
                    </div>
                    <span className="text-2xl font-black">{stats.present}</span>
                  </Card>

                  <Card className="flex w-full flex-col items-center justify-center border-black bg-white p-2.5 transition-none">
                    <div className="flex items-center gap-1 text-xs font-bold uppercase">
                      <XCircle className="w-4 h-4" /> Absent
                    </div>
                    <span className="text-2xl font-black">{stats.absent}</span>
                  </Card>

                  <Card className="flex w-full flex-col items-center justify-center border-black bg-white p-2.5 transition-none">
                    <div className="flex items-center gap-1 text-xs font-bold uppercase">
                      <Clock className="w-4 h-4" /> Late
                    </div>
                    <span className="text-2xl font-black">{stats.late}</span>
                  </Card>

                  <Card className="flex w-full flex-col items-center justify-center border-black bg-white p-2.5 transition-none">
                    <div className="flex items-center gap-1 text-xs font-bold uppercase">
                      <UserCheck className="w-4 h-4" /> Excused
                    </div>
                    <span className="text-2xl font-black">{stats.excused}</span>
                  </Card>

                  <Card className="col-span-2 flex w-full flex-col items-center justify-center border-black bg-white p-2.5 transition-none sm:col-span-1">
                    <div className="text-xs font-bold uppercase text-gray-500">
                      Daily Rate
                    </div>
                    <span className="text-2xl font-black">{stats.rate}%</span>
                  </Card>
                </div>

                {/* Quick Bulk Actions & Save Bar */}
                <Card className="flex w-full flex-wrap items-center justify-between gap-3 border-black bg-white p-3 transition-none">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase text-gray-500 mr-1">
                      Bulk Mark:
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markAll("present")}
                      className="text-xs font-bold border-black bg-emerald-100 hover:bg-emerald-200"
                    >
                      All Present
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markAll("absent")}
                      className="text-xs font-bold border-black bg-red-100 hover:bg-red-200"
                    >
                      All Absent
                    </Button>
                  </div>

                  <Button
                    onClick={handleSaveAttendance}
                    disabled={saving || studentList.length === 0}
                    className="flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                      </>
                    ) : saveSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" /> Saved
                        Successfully!
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
                  <div className="flex flex-col items-center justify-center p-12 text-gray-500 border-2 border-black bg-white">
                    <Loader2 className="w-8 h-8 animate-spin mb-2 text-black" />
                    <p className="font-semibold">Loading student roster...</p>
                  </div>
                ) : filteredStudents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-gray-500 border-2 border-black bg-white">
                    <Users className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-lg font-bold">No students found</p>
                    <p className="text-sm">
                      Select a valid class or clear search term.
                    </p>
                  </div>
                ) : (
                  <Table
                    wrapperClassName="overflow-x-auto border-2 border-black"
                    className="min-w-[850px] border-collapse bg-white"
                  >
                    <Table.Header>
                      <Table.Row className="hover:bg-primary hover:text-primary-foreground">
                        <th className="p-3 border-r-2 border-black">#</th>
                        <th className="p-3 border-r-2 border-black">LRN</th>
                        <th className="p-3 border-r-2 border-black">
                          Student Name
                        </th>
                        <th className="p-3 border-r-2 border-black text-center">
                          Status
                        </th>
                        <th className="p-3">Remarks / Reason</th>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body className="text-sm">
                      {filteredStudents.map((student, index) => (
                        <tr
                          key={student.student_id}
                          className={`border-b-2 border-black hover:bg-gray-50 transition-colors ${
                            student.status === "absent"
                              ? "bg-red-50/50"
                              : student.status === "late"
                                ? "bg-amber-50/50"
                                : student.status === "excused"
                                  ? "bg-blue-50/50"
                                  : ""
                          }`}
                        >
                          <td className="p-3 font-bold text-xs border-r-2 border-black text-gray-500">
                            {index + 1}
                          </td>
                          <td className="p-3 font-mono text-xs font-semibold border-r-2 border-black">
                            {student.student_lrn}
                          </td>
                          <td className="p-3 font-bold border-r-2 border-black">
                            {student.student_name}
                          </td>

                          {/* Status Buttons */}
                          <td className="p-3 border-r-2 border-black">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setStatus(student.student_id, "present")
                                }
                                className={`px-3 py-1 text-xs font-bold border-2 border-black rounded-none transition-all ${
                                  student.status === "present"
                                    ? "bg-emerald-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                    : "bg-white text-emerald-800 hover:bg-emerald-50"
                                }`}
                              >
                                Present
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setStatus(student.student_id, "absent")
                                }
                                className={`px-3 py-1 text-xs font-bold border-2 border-black rounded-none transition-all ${
                                  student.status === "absent"
                                    ? "bg-red-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                    : "bg-white text-red-800 hover:bg-red-50"
                                }`}
                              >
                                Absent
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setStatus(student.student_id, "late")
                                }
                                className={`px-3 py-1 text-xs font-bold border-2 border-black rounded-none transition-all ${
                                  student.status === "late"
                                    ? "bg-amber-500 text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                    : "bg-white text-amber-800 hover:bg-amber-50"
                                }`}
                              >
                                Late
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setStatus(student.student_id, "excused")
                                }
                                className={`px-3 py-1 text-xs font-bold border-2 border-black rounded-none transition-all ${
                                  student.status === "excused"
                                    ? "bg-blue-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
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
                              onChange={(e) =>
                                setRemarks(student.student_id, e.target.value)
                              }
                              className="w-full text-xs font-medium p-1.5 border-2 border-gray-300 rounded-none focus:border-black focus:outline-none"
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
                {/* Global Controls & Layout Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-gray-50 p-3">
                  <div>
                    <h2 className="text-lg font-extrabold">
                      Attendance Summary & Log Explorer
                    </h2>
                    <p className="text-xs text-gray-500 font-semibold">
                      View cumulative totals or switch to the complete Date Grid
                      Log Sheet.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Global Expand / Collapse All Toggle */}
                    {summaryLayout === "summary" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandAll(!expandAll)}
                        className="text-xs font-bold border-black bg-white"
                      >
                        {expandAll ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5 mr-1 inline" />{" "}
                            Collapse All Logs
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5 mr-1 inline" /> Expand
                            All Logs
                          </>
                        )}
                      </Button>
                    )}

                    {/* Status Filter */}
                    <div className="flex items-center gap-1 border-2 border-black bg-white p-1">
                      <ListFilter className="w-3.5 h-3.5 ml-1 text-gray-500" />
                      <select
                        value={statusFilter}
                        onChange={(e: any) => setStatusFilter(e.target.value)}
                        className="text-xs font-bold bg-transparent focus:outline-none p-0.5"
                      >
                        <option value="all">All Students</option>
                        <option value="absent">Has Absences</option>
                        <option value="late">Has Tardies</option>
                        <option value="excused">Has Excused</option>
                      </select>
                    </div>

                    {/* View Switcher: Summary Matrix vs Date Grid Sheet */}
                    <div className="flex items-center border-2 border-black bg-white">
                      <button
                        onClick={() => setSummaryLayout("summary")}
                        className={`px-3 py-1 text-xs font-bold transition-all ${
                          summaryLayout === "summary"
                            ? "bg-black text-white"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        <BarChart3 className="w-3.5 h-3.5 inline mr-1" />{" "}
                        Summary
                      </button>
                      <button
                        onClick={() => setSummaryLayout("date_grid")}
                        className={`px-3 py-1 text-xs font-bold transition-all border-l-2 border-black ${
                          summaryLayout === "date_grid"
                            ? "bg-black text-white"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        <TableIcon className="w-3.5 h-3.5 inline mr-1" /> Full
                        Date Sheet
                      </button>
                    </div>
                  </div>
                </div>

                {loadingLogs ? (
                  <div className="flex flex-col items-center justify-center p-12 text-gray-500 border-2 border-black bg-white">
                    <Loader2 className="w-8 h-8 animate-spin mb-2 text-black" />
                    <p className="font-semibold">
                      Calculating attendance summaries...
                    </p>
                  </div>
                ) : summaryMatrix.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-gray-500 border-2 border-black bg-white">
                    <BarChart3 className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-lg font-bold">
                      No attendance records found
                    </p>
                    <p className="text-sm">
                      Mark attendance for this class to populate the summary
                      report.
                    </p>
                  </div>
                ) : summaryLayout === "summary" ? (
                  /* Standard Summary Table with Individual or Global Expand */
                  <div className="border-2 border-black bg-white overflow-x-auto shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b-2 border-black bg-gray-100 text-xs font-extrabold uppercase">
                          <th className="p-3 border-r-2 border-black">#</th>
                          <th className="p-3 border-r-2 border-black">
                            Student Name
                          </th>
                          <th className="p-3 border-r-2 border-black text-center">
                            Total Days
                          </th>
                          <th className="p-3 border-r-2 border-black text-center text-emerald-800">
                            Present
                          </th>
                          <th className="p-3 border-r-2 border-black text-center text-red-800">
                            Absent
                          </th>
                          <th className="p-3 border-r-2 border-black text-center text-amber-800">
                            Late
                          </th>
                          <th className="p-3 border-r-2 border-black text-center text-blue-800">
                            Excused
                          </th>
                          <th className="p-3 border-r-2 border-black text-center">
                            Attendance Rate
                          </th>
                          <th className="p-3 text-center">Logs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y-2 divide-black text-sm">
                        {summaryMatrix.map((item, index) => {
                          const isExpanded =
                            expandAll || expandedStudentId === item.student_id;
                          return (
                            <Fragment key={item.student_id}>
                              <tr className="group hover:bg-gray-50">
                                <td className="p-3 font-bold text-xs border-r-2 border-black text-gray-500">
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
                                    className={`rounded-none font-bold ${
                                      item.rate < 75
                                        ? "border-red-600 bg-red-100 text-red-900"
                                        : ""
                                    }`}
                                  >
                                    {item.rate}%
                                  </Badge>
                                </td>
                                <td className="p-3 text-center">
                                  <button
                                    onClick={() =>
                                      setExpandedStudentId(
                                        isExpanded && !expandAll
                                          ? null
                                          : item.student_id,
                                      )
                                    }
                                    className="text-xs font-bold flex items-center justify-center gap-1 mx-auto hover:underline"
                                  >
                                    {isExpanded ? "Hide" : "View"} Logs
                                    {isExpanded ? (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-gray-50 border-b-2 border-black">
                                  <td colSpan={9} className="p-4">
                                    <div className="flex flex-col gap-2">
                                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
                                        Attendance History for{" "}
                                        {item.student_name}
                                      </h4>
                                      {item.history.length === 0 ? (
                                        <p className="text-xs italic text-gray-500">
                                          No individual date logs recorded yet.
                                        </p>
                                      ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                          {item.history.map((log) => (
                                            <div
                                              key={log.attendance_id}
                                              className="p-2 border-2 border-black bg-white flex items-center justify-between text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                            >
                                              <div>
                                                <span className="font-bold block">
                                                  {log.date}
                                                </span>
                                                {log.remarks && (
                                                  <span className="text-gray-500 text-[11px] block">
                                                    {log.remarks}
                                                  </span>
                                                )}
                                              </div>
                                              <Badge
                                                variant={
                                                  log.status === "present"
                                                    ? "default"
                                                    : log.status === "absent"
                                                      ? "outline"
                                                      : "surface"
                                                }
                                                size="sm"
                                                className="rounded-none"
                                              >
                                                {log.status.toUpperCase()}
                                              </Badge>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* Full Date Grid Log Sheet Matrix (Dates as columns, Students as rows) */
                  <div className="border-2 border-black bg-white overflow-x-auto shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead>
                        <tr className="border-b-2 border-black bg-gray-100 text-xs font-extrabold uppercase">
                          <th className="p-3 border-r-2 border-black sticky left-0 bg-gray-100 z-10">
                            #
                          </th>
                          <th className="p-3 border-r-2 border-black sticky left-8 bg-gray-100 z-10 min-w-[160px]">
                            Student Name
                          </th>
                          {uniqueDates.map((date) => (
                            <th
                              key={date}
                              className="p-2 border-r-2 border-black text-center text-[11px] min-w-[70px]"
                            >
                              {date}
                            </th>
                          ))}
                          <th className="p-3 text-center sticky right-0 bg-gray-100 z-10">
                            Rate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y-2 divide-black text-xs">
                        {summaryMatrix.map((student, idx) => (
                          <tr
                            key={student.student_id}
                            className="hover:bg-gray-50"
                          >
                            <td className="p-2 font-bold border-r-2 border-black sticky left-0 bg-white z-10">
                              {idx + 1}
                            </td>
                            <td className="p-2 font-bold border-r-2 border-black sticky left-8 bg-white z-10 truncate max-w-[180px]">
                              {student.student_name}
                            </td>
                            {uniqueDates.map((date) => {
                              const log = student.logByDate.get(date);
                              const st = log?.status;
                              return (
                                <td
                                  key={date}
                                  className="p-2 border-r-2 border-black text-center font-bold"
                                >
                                  {st === "present" ? (
                                    <span className="inline-block w-6 h-6 leading-6 border-2 border-black bg-emerald-600 text-white text-[11px]">
                                      P
                                    </span>
                                  ) : st === "absent" ? (
                                    <span className="inline-block w-6 h-6 leading-6 border-2 border-black bg-red-600 text-white text-[11px]">
                                      A
                                    </span>
                                  ) : st === "late" ? (
                                    <span className="inline-block w-6 h-6 leading-6 border-2 border-black bg-amber-400 text-black text-[11px]">
                                      L
                                    </span>
                                  ) : st === "excused" ? (
                                    <span className="inline-block w-6 h-6 leading-6 border-2 border-black bg-blue-600 text-white text-[11px]">
                                      E
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 font-normal">
                                      -
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="p-2 text-center font-bold sticky right-0 bg-white z-10 border-l-2 border-black">
                              {student.rate}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              /* Leave Requests Section */
              <div className="flex flex-col gap-4">
                <h2 className="text-xl font-bold">Student Leave Requests</h2>
                {leaveRequests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-gray-500 border-2 border-black bg-white">
                    <FileText className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-lg font-bold">No leave requests</p>
                    <p className="text-sm">
                      No leave requests have been submitted for this class.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {leaveRequests.map((req) => (
                      <Card
                        key={req.leave_request_id}
                        className="block w-full border-black bg-white p-4 transition-none flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-extrabold text-base">
                              {req.student_name || "Student"}
                            </h3>
                            <p className="text-xs text-gray-500 font-semibold">
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
                            className="rounded-none"
                          >
                            {req.status.toUpperCase()}
                          </Badge>
                        </div>

                        <div className="bg-gray-50 p-2 border-2 border-black text-xs font-medium">
                          <span className="font-bold block mb-0.5">
                            Reason:
                          </span>
                          {req.reason}
                        </div>

                        {req.status === "pending" && (
                          <div className="flex items-center gap-2 pt-2 border-t-2 border-black">
                            <Button
                              size="sm"
                              onClick={() =>
                                handleReviewLeave(
                                  req.leave_request_id,
                                  "approved",
                                )
                              }
                              className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-xs flex-1 flex items-center justify-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleReviewLeave(
                                  req.leave_request_id,
                                  "rejected",
                                )
                              }
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
