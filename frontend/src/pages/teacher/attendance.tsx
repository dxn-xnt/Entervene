import { useEffect, useState, useMemo } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { OverviewCard } from "@/components/overview-cards";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Table } from "@/components/retroui/Table";
import { Label } from "@/components/retroui/Label";
import { Avatar } from "@/components/retroui/Avatar";
import { Select } from "@/components/retroui/Select";
import { Tabs } from "@/components/retroui/Tabs";
import { Dialog } from "@/components/retroui/Dialog";
import ViewAttendanceLogModal from "./forms/view-attendance-log";
import { cn } from "@/lib/utils";
import { apiFetch, getTeacherAdvisoryClasses } from "@/lib/api";
import {
  getClassAttendanceLogs,
  recordBatchAttendance,
  type AttendanceStatus,
  type AttendanceRecordItem,
} from "@/lib/attendance-api";
import {
  Search,
  Save,
  Check,
  Users,
  BarChart3,
  Table as TableIcon,
  X,
  ArrowUpRight,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

type StudentInfo = {
  student_id: string;
  student_lrn?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  gender?: string;
  avatar?: string;
  avatar_initial?: string;
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
  gender: string;
  avatar?: string;
  avatar_initial?: string;
  status: AttendanceStatus;
  remarks: string;
};

function groupStudentsByGender<T extends { gender?: string | null }>(students: T[]) {
  const males: T[] = [];
  const females: T[] = [];
  students.forEach((s) => {
    if (s.gender?.toLowerCase() === "male") {
      males.push(s);
    } else {
      females.push(s);
    }
  });
  return { males, females };
}

type StudentSummaryStats = {
  student_id: string;
  student_name: string;
  student_lrn: string;
  gender?: string;
  avatar?: string;
  avatar_initial?: string;
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
  const [activeTab, setActiveTab] = useState<"marking" | "summary">(
    "marking",
  );

  // Summary View Options
  const [summaryLayout, setSummaryLayout] = useState<"summary" | "date_grid">(
    "summary",
  );
  const [statusFilter, setStatusFilter] = useState<
    "all" | "absent" | "late" | "excused"
  >("all");

  const [studentList, setStudentList] = useState<StudentAttendanceState[]>([]);
  const [allClassLogs, setAllClassLogs] = useState<AttendanceRecordItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedStudentLogs, setSelectedStudentLogs] =
    useState<StudentSummaryStats | null>(null);

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
            gender: s.gender || "Unspecified",
            avatar: s.avatar,
            avatar_initial: s.avatar_initial,
            status: (log?.status as AttendanceStatus) || "present",
            remarks: log?.remarks || "",
          };
        });

        setStudentList(initialStates);
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
        gender: s.gender,
        avatar: s.avatar,
        avatar_initial: s.avatar_initial,
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
            <header className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-bold">Attendance</h1>
                </div>
              </div>
            </header>

            <Tabs
              tabs={[
                {
                  id: "marking",
                  label: "Mark Attendance",
                  icon: Users,
                },
                {
                  id: "summary",
                  label: "Attendance Summary & Logs",
                  icon: BarChart3,
                },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-1">
              <OverviewCard
                title="Present"
                count={String(stats.present)}
                statDescription="Students present"
              />
              <OverviewCard
                title="Absent"
                count={String(stats.absent)}
                statDescription="Students absent"
              />
              <OverviewCard
                title="Late"
                count={String(stats.late)}
                statDescription="Students arrived late"
              />
              <OverviewCard
                title="Excused"
                count={String(stats.excused)}
                statDescription="Excused absences"
              />
              <OverviewCard
                title="Daily Rate"
                count={`${stats.rate}%`}
                statDescription="Overall attendance rate"
                className="col-span-2 sm:col-span-1"
              />
            </div>

            {activeTab === "marking" ? (
              <>
                {/* Filters & Control Bar */}
                <div className="flex flex-row gap-4 items-center w-full mb-1">
                  {/* Class Selector */}
                  <div className="flex flex-col gap-1">
                    <Label className="font-sans text-sm font-semibold">
                      Classes
                    </Label>
                    <Select
                      value={selectedTargetKey}
                      onValueChange={(val) => setSelectedTargetKey(val)}
                    >
                      <Select.Trigger className="w-full min-w-[350px]">
                        <Select.Value placeholder="Select class / subject" />
                      </Select.Trigger>
                      <Select.Content>
                        {advisoryTargets.length > 0 && (
                          <Select.Group>
                            <Select.Label className="px-2 py-1.5 text-xs font-bold text-muted-foreground">
                              Advisory Classes (Homeroom Attendance)
                            </Select.Label>
                            {advisoryTargets.map((t) => (
                              <Select.Item key={t.key} value={t.key} className="text-sm">
                                {t.label}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        )}
                        {subjectTargets.length > 0 && (
                          <Select.Group>
                            <Select.Label className="px-2 py-1.5 text-xs font-bold text-muted-foreground">
                              Subject Teaching Classes
                            </Select.Label>
                            {subjectTargets.map((t) => (
                              <Select.Item key={t.key} value={t.key} className="text-sm">
                                {t.label}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        )}
                      </Select.Content>
                    </Select>
                  </div>

                  {/* Date Selector (Only shown for Marking tab) */}
                  <div className="min-w-[250px] flex flex-col gap-1">
                    <Label className="font-sans text-sm font-semibold">
                      Attendance Date
                    </Label>
                    <Input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="rounded-none border-black h-10 w-full bg-white text-md font-sans"
                    />
                  </div>

                  {/* Search */}
                  <div className="w-full flex flex-col gap-1">
                    <Label className="font-sans text-sm font-semibold">
                      Search
                    </Label>
                    <div className="relative w-full">
                      <Search className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
                      <Input
                        type="text"
                        placeholder="Search name or LRN..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="rounded-none border-black h-10 w-full bg-white pl-9"
                      />
                    </div>
                  </div>
                </div>

                <Card className="block w-full border-black bg-white transition-none shadow-md hover:shadow-none">
                  <div className="flex w-full flex-wrap items-end justify-between gap-3 border-black bg-white py-3 transition-none">
                    <div className="flex flex-row gap-3 items-center">
                      <span className="text-sm font-semibold">
                        Mark All:
                      </span>
                      <div className="flex flex-row gap-2">
                        <Button
                          size="sm"
                          onClick={() => markAll("present")}
                          className="bg-success/80 shadow-none hover:bg-success"
                        >
                          <Check size="14" className="mr-2" />
                          Present
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => markAll("absent")}
                          className="bg-destructive/80 shadow-none hover:bg-destructive"
                        >
                          <X size="14" className="mr-2" />
                          Absent
                        </Button>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={handleSaveAttendance}
                      disabled={saving || studentList.length === 0}
                      className="flex items-center gap-2 shadow-none"
                    >
                      {saveSuccess ? (
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
                  </div>

                  {/* Attendance Roster Table */}
                  {loadingLogs ? (
                    <LoadingPanel label="Loading student roster..." />
                  ) : filteredStudents.length === 0 ? (
                    <Empty className="">
                      <EmptyHeader>
                        <EmptyMedia>
                          <div className="flex -space-x-2 *:data-[slot=avatar]:size-12 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background *:data-[slot=avatar]:grayscale">
                            <Avatar variant="student" >
                              <Avatar.Image
                                src="/avatars/student-avatars/3.svg"
                                alt="@shadcn" />
                              <Avatar.Fallback>CN</Avatar.Fallback>
                            </Avatar>
                            <Avatar variant="student" >
                              <Avatar.Image
                                src="/avatars/student-avatars/2.svg"
                                alt="@maxleiter"
                              />
                              <Avatar.Fallback>LR</Avatar.Fallback>
                            </Avatar>
                            <Avatar variant="student" >
                              <Avatar.Image
                                src="/avatars/student-avatars/1.svg"
                                alt="@evilrabbit"
                              />
                              <Avatar.Fallback>ER</Avatar.Fallback>
                            </Avatar>
                          </div>
                        </EmptyMedia>
                        <EmptyTitle>No Students Found</EmptyTitle>

                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <Table
                      wrapperClassName="overflow-visible h-auto shadow-none"
                      className="bg-background shadow-none"
                    >
                      <Table.Header>
                        <Table.Row>
                          <Table.Head>
                            Student Name
                          </Table.Head>
                          <Table.Head className="text-center">
                            Status
                          </Table.Head>
                          <Table.Head>
                            Remarks
                          </Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body className="text-sm">
                        {(() => {
                          const { males, females } = groupStudentsByGender(filteredStudents);

                          const renderRow = (student: StudentAttendanceState) => (
                            <Table.Row
                              key={student.student_id}
                              className={`border-b-2 border-black transition-colors ${student.status === "absent"
                                ? "bg-red-50/50"
                                : student.status === "late"
                                  ? "bg-amber-50/50"
                                  : student.status === "excused"
                                    ? "bg-blue-50/50"
                                    : ""
                                }`}
                            >
                              <Table.Cell>
                                <div className="flex items-center gap-3">
                                  <Avatar variant="student" className="size-8 shrink-0">
                                    <Avatar.Image
                                      src={student.avatar || "/avatars/student-avatars/1.svg"}
                                      alt={student.student_name}
                                    />
                                    <Avatar.Fallback>
                                      {(student.avatar_initial || student.student_name || "?")
                                        .charAt(0)
                                        .toUpperCase()}
                                    </Avatar.Fallback>
                                  </Avatar>
                                  <span className="font-semibold text-base">
                                    {student.student_name}
                                  </span>
                                </div>
                              </Table.Cell>

                              {/* Status Select */}
                              <Table.Cell className="text-center">
                                <Select
                                  value={student.status}
                                  onValueChange={(value) =>
                                    setStatus(student.student_id, value as AttendanceStatus)
                                  }
                                >
                                  <Select.Trigger
                                    className={cn(
                                      "w-36 mx-auto font-semibold border-2 border-black shadow-none",

                                    )}
                                  >
                                    <Select.Value />
                                  </Select.Trigger>
                                  <Select.Content className="">
                                    <Select.Group>
                                      <Select.Item value="present">Present</Select.Item>
                                      <Select.Item value="absent">Absent</Select.Item>
                                      <Select.Item value="late">Late</Select.Item>
                                      <Select.Item value="excused">Excused</Select.Item>
                                    </Select.Group>
                                  </Select.Content>
                                </Select>
                              </Table.Cell>

                              <Table.Cell className="">
                                <Input
                                  type="text"
                                  className="w-full text-sm border-transparent hover:border-gray-300 focus:border-black outline-none bg-transparent transition-colors placeholder:text-gray-400 rounded-none shadow-none focus:shadow-none"
                                  placeholder={
                                    student.status !== "present"
                                      ? "Add remarks..."
                                      : "-"
                                  }
                                  value={student.remarks}
                                  onChange={(e) =>
                                    setRemarks(student.student_id, e.target.value)
                                  }
                                />
                              </Table.Cell>
                            </Table.Row>
                          );

                          return (
                            <>
                              {males.length > 0 && (
                                <>
                                  <Table.Row className="hover:bg-accent border-y-2">
                                    <Table.Cell
                                      colSpan={3}
                                      className="p-1! text-sm font-semibold text-center bg-primary pr-10!"
                                    >
                                      Male
                                    </Table.Cell>
                                  </Table.Row>
                                  {males.map((student) => renderRow(student))}
                                </>
                              )}
                              {females.length > 0 && (
                                <>
                                  <Table.Row className="hover:bg-accent border-b-2 p-0!">
                                    <Table.Cell
                                      colSpan={3}
                                      className="p-1! text-sm font-semibold text-center bg-primary pr-10!"
                                    >
                                      Female
                                    </Table.Cell>
                                  </Table.Row>
                                  {females.map((student) => renderRow(student))}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </Table.Body>
                    </Table>
                  )}
                </Card>
                {/* Quick Bulk Actions & Save Bar */}

              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-center mb-1">
                  {/* Class Selector */}
                  <div className="flex flex-col gap-1">
                    <Label className="font-sans text-sm font-semibold">
                      Classes
                    </Label>
                    <Select
                      value={selectedTargetKey}
                      onValueChange={(val) => setSelectedTargetKey(val)}
                    >
                      <Select.Trigger className="w-full min-w-[350px]">
                        <Select.Value placeholder="Select class / subject" />
                      </Select.Trigger>
                      <Select.Content>
                        {advisoryTargets.length > 0 && (
                          <Select.Group>
                            <Select.Label className="px-2 py-1.5 text-xs font-bold text-muted-foreground">
                              Advisory Classes (Homeroom Attendance)
                            </Select.Label>
                            {advisoryTargets.map((t) => (
                              <Select.Item key={t.key} value={t.key} className="text-sm">
                                {t.label}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        )}
                        {subjectTargets.length > 0 && (
                          <Select.Group>
                            <Select.Label className="px-2 py-1.5 text-xs font-bold text-muted-foreground">
                              Subject Teaching Classes
                            </Select.Label>
                            {subjectTargets.map((t) => (
                              <Select.Item key={t.key} value={t.key} className="text-sm">
                                {t.label}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        )}
                      </Select.Content>
                    </Select>
                  </div>

                  {/* Search */}
                  <div className="sm:col-span-2 flex flex-col gap-1">
                    <Label className="font-sans text-sm font-semibold">
                      Search
                    </Label>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
                      <Input
                        type="text"
                        placeholder="Search name or LRN..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="rounded-none border-black h-10 w-full bg-white pl-9"
                      />
                    </div>
                  </div>
                </div>

                {/* Filters & Control Bar */}
                <Card className="block w-full border-black bg-white transition-none">

                  {/* Attendance Summary & Report Matrix */}
                  <div className="flex flex-col gap-4 mt-3">
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
                        {/* Status Filter */}
                        <div className="flex items-center gap-1">
                          <Select
                            value={statusFilter}
                            onValueChange={(val) =>
                              setStatusFilter(
                                val as "all" | "absent" | "late" | "excused",
                              )
                            }
                          >
                            <Select.Trigger className="w-36 h-9 shadow-none text-xs font-bold border-2 border-black bg-white">
                              <Select.Value />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Group>
                                <Select.Item value="all" className="text-xs font-semibold">
                                  All Students
                                </Select.Item>
                                <Select.Item value="absent" className="text-xs font-semibold">
                                  Has Absences
                                </Select.Item>
                                <Select.Item value="late" className="text-xs font-semibold">
                                  Has Tardies
                                </Select.Item>
                                <Select.Item value="excused" className="text-xs font-semibold">
                                  Has Excused
                                </Select.Item>
                              </Select.Group>
                            </Select.Content>
                          </Select>
                        </div>

                        {/* View Switcher: Summary Matrix vs Date Grid Sheet */}
                        <div className="flex items-center">
                          <Button
                            size="sm"
                            variant={summaryLayout === "summary" ? "default" : "outline"}
                            onClick={() => setSummaryLayout("summary")}
                            className="text-xs font-bold border-black rounded-r-none border-r-0 shadow-none hover:shadow-none"
                          >
                            <BarChart3 className="w-3.5 h-3.5 inline mr-1" />{" "}
                            Summary
                          </Button>
                          <Button
                            size="sm"
                            variant={summaryLayout === "date_grid" ? "default" : "outline"}
                            onClick={() => setSummaryLayout("date_grid")}
                            className="text-xs font-bold border-black rounded-l-none shadow-none hover:shadow-none"
                          >
                            <TableIcon className="w-3.5 h-3.5 inline mr-1" /> Full Date Sheet
                          </Button>
                        </div>
                      </div>
                    </div>

                    {loadingLogs ? (
                      <LoadingPanel label="Calculating attendance summaries..." />
                    ) : summaryMatrix.length === 0 ? (
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia>
                            <BarChart3 className="w-10 h-10 opacity-50" />
                          </EmptyMedia>
                          <EmptyTitle>No attendance records found</EmptyTitle>
                          <EmptyDescription>
                            Mark attendance for this class to populate the summary report.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : summaryLayout === "summary" ? (
                      /* Standard Summary Table with Individual or Global Expand */
                      <Table
                        wrapperClassName="overflow-visible h-auto shadow-none"
                        className="bg-background shadow-none"
                      >
                        <Table.Header>
                          <Table.Row>
                            <Table.Head>
                              Student Name
                            </Table.Head>
                            <Table.Head className="text-center">
                              Present
                            </Table.Head>
                            <Table.Head className="text-center">
                              Absent
                            </Table.Head>
                            <Table.Head className="text-center">
                              Late
                            </Table.Head>
                            <Table.Head className="text-center">
                              Excused
                            </Table.Head>
                            <Table.Head className="text-center">
                              Attendance Rate
                            </Table.Head>
                            <Table.Head className="w-16 text-right pr-4">
                              Logs
                            </Table.Head>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body className="divide-y-2 divide-black text-sm">
                          {summaryMatrix.map((item) => (
                            <Table.Row key={item.student_id}>
                              <Table.Cell>
                                <div className="flex items-center gap-3">
                                  <Avatar variant="student" className="size-8 shrink-0">
                                    <Avatar.Image
                                      src={item.avatar || "/avatars/student-avatars/1.svg"}
                                      alt={item.student_name}
                                    />
                                    <Avatar.Fallback>
                                      {(item.avatar_initial || item.student_name || "?")
                                        .charAt(0)
                                        .toUpperCase()}
                                    </Avatar.Fallback>
                                  </Avatar>
                                  <span className="font-semibold text-base">
                                    {item.student_name}

                                  </span>
                                </div>

                              </Table.Cell>
                              <Table.Cell className="text-center">
                                {item.present}
                              </Table.Cell>
                              <Table.Cell className="text-center">
                                {item.absent}
                              </Table.Cell>
                              <Table.Cell className="text-center">
                                {item.late}
                              </Table.Cell>
                              <Table.Cell className="text-center">
                                {item.excused}
                              </Table.Cell>
                              <Table.Cell className="text-center">
                                <Badge
                                  size="sm"
                                  variant={
                                    item.rate >= 90
                                      ? "surface"
                                      : item.rate >= 75
                                        ? "surface"
                                        : "outline"
                                  }
                                  className={` ${item.rate < 75
                                    ? "border-red-600 bg-red-100 text-red-900"
                                    : ""
                                    }`}
                                >
                                  {item.rate}%
                                </Badge>
                              </Table.Cell>
                              <Table.Cell className="text-right pr-4">
                                <Button
                                  size="sm"
                                  onClick={() => setSelectedStudentLogs(item)}
                                  className="shadow-none p-1 ml-auto"
                                  title="View attendance log"
                                >
                                  <ArrowUpRight size={16} />
                                </Button>
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table>
                    ) : (
                      /* Full Date Grid Log Sheet Matrix (Dates as columns, Students as rows) */
                      <Table
                        wrapperClassName="overflow-x-auto h-auto shadow-none border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                        className="bg-background min-w-[700px] border-collapse shadow-none"
                      >
                        <Table.Header className="bg-gray-100 text-black border-b-2 border-black">
                          <Table.Row className="hover:bg-transparent">
                            <Table.Head className="p-3 border-r-2 border-black sticky left-0 bg-gray-100 z-10 text-black font-extrabold text-xs uppercase">
                              #
                            </Table.Head>
                            <Table.Head className="p-3 border-r-2 border-black sticky left-8 bg-gray-100 z-10 min-w-[160px] text-black font-extrabold text-xs uppercase">
                              Student Name
                            </Table.Head>
                            {uniqueDates.map((date) => (
                              <Table.Head
                                key={date}
                                className="p-2 border-r-2 border-black text-center text-[11px] min-w-[70px] text-black font-extrabold uppercase"
                              >
                                {date}
                              </Table.Head>
                            ))}
                            <Table.Head className="p-3 text-center sticky right-0 bg-gray-100 z-10 text-black font-extrabold text-xs uppercase">
                              Rate
                            </Table.Head>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body className="divide-y-2 divide-black text-xs">
                          {summaryMatrix.map((student, idx) => (
                            <Table.Row
                              key={student.student_id}
                              className="hover:bg-gray-50 border-b-2 border-black"
                            >
                              <Table.Cell className="p-2 font-bold border-r-2 border-black sticky left-0 bg-white z-10">
                                {idx + 1}
                              </Table.Cell>
                              <Table.Cell className="p-2 font-bold border-r-2 border-black sticky left-8 bg-white z-10 truncate max-w-[180px]">
                                {student.student_name}
                              </Table.Cell>
                              {uniqueDates.map((date) => {
                                const log = student.logByDate.get(date);
                                const st = log?.status;
                                return (
                                  <Table.Cell
                                    key={date}
                                    className="p-2 border-r-2 border-black text-center font-bold"
                                  >
                                    {st === "present" ? (
                                      <Badge
                                        variant="default"
                                        size="sm"
                                        className="rounded-none bg-emerald-600 border-black text-white px-1.5 py-0.5 text-[11px] font-bold"
                                      >
                                        P
                                      </Badge>
                                    ) : st === "absent" ? (
                                      <Badge
                                        variant="outline"
                                        size="sm"
                                        className="rounded-none bg-red-600 border-black text-white px-1.5 py-0.5 text-[11px] font-bold"
                                      >
                                        A
                                      </Badge>
                                    ) : st === "late" ? (
                                      <Badge
                                        variant="surface"
                                        size="sm"
                                        className="rounded-none bg-amber-400 border-black text-black px-1.5 py-0.5 text-[11px] font-bold"
                                      >
                                        L
                                      </Badge>
                                    ) : st === "excused" ? (
                                      <Badge
                                        variant="default"
                                        size="sm"
                                        className="rounded-none bg-blue-600 border-black text-white px-1.5 py-0.5 text-[11px] font-bold"
                                      >
                                        E
                                      </Badge>
                                    ) : (
                                      <span className="text-gray-400 font-normal">
                                        -
                                      </span>
                                    )}
                                  </Table.Cell>
                                );
                              })}
                              <Table.Cell className="p-2 text-center font-bold sticky right-0 bg-white z-10 border-l-2 border-black">
                                {student.rate}%
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table>
                    )}
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Attendance Logs Dialog Modal */}
      <Dialog
        open={selectedStudentLogs !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedStudentLogs(null);
        }}
      >
        {selectedStudentLogs && (
          <ViewAttendanceLogModal
            studentName={selectedStudentLogs.student_name}
            studentLrn={selectedStudentLogs.student_lrn}
            avatar={selectedStudentLogs.avatar}
            avatarInitial={selectedStudentLogs.avatar_initial}
            sectionName={selectedTarget?.section_name}
            subjectName={selectedTarget?.is_advisory ? undefined : selectedTarget?.subject_name}
            rate={selectedStudentLogs.rate}
            history={selectedStudentLogs.history}
          />
        )}
      </Dialog>
    </AppLayout>
  );
}
