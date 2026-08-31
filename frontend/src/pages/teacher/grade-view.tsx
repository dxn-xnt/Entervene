import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useParams } from "react-router-dom";
import { Ellipsis, Plus, Search, Download, Send, CheckCircle2, AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Card } from "@/components/retroui/Card";
import ViewGradeScoreModal from "./forms/view-grade-scores";
import AddClassworkScoreModal from "./forms/add-classwork-score";
import EnterManualScoresModal from "./forms/enter-manual-scores";
import {
  getTeacherGradebook,
  getTeacherAvailablePeriods,
  getTeacherTermSummary,
  sendStudentGradeToAdviser,
  bulkSendGradesToAdviser,
  type StudentGradebookResponse,
  type StudentGradebookRow,
  type GradebookCategoryHeader,
  type TermGradeSummaryResponse,
  type TermPeriodInfo,
  type BulkSendGradesToAdviserResponse
} from "@/lib/api";

function fmt(val: number | null | undefined, d = 1): string {
  if (val == null) return "—";
  return val.toFixed(d);
}

/** Helper to get at most 2 latest items (or scores) arranged latest to oldest (newest first). */
function getLatestTwo<T>(arr: T[]): { item: T; originalIndex: number }[] {
  if (!arr || arr.length === 0) return [];
  const result: { item: T; originalIndex: number }[] = [];
  const start = Math.max(0, arr.length - 2);
  for (let i = arr.length - 1; i >= start; i--) {
    result.push({ item: arr[i], originalIndex: i });
  }
  return result;
}

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

const GRADE_SUBMISSION_WINDOW_DAYS = 7;

function getTimingGateInfo(period?: TermPeriodInfo | null) {
  if (!period || !period.end_date) {
    return {
      isLocked: false,
      isEarly: false,
      isClosed: false,
      unlockDate: null,
      formattedUnlockDate: null,
      closeDate: null,
      formattedCloseDate: null,
      message: "",
    };
  }
  const endParts = String(period.end_date).split("-").map(Number);
  if (endParts.length !== 3) {
    return {
      isLocked: false,
      isEarly: false,
      isClosed: false,
      unlockDate: null,
      formattedUnlockDate: null,
      closeDate: null,
      formattedCloseDate: null,
      message: "",
    };
  }
  const [year, month, day] = endParts;
  const unlockDateObj = new Date(year, month - 1, day - GRADE_SUBMISSION_WINDOW_DAYS);
  const closeDateObj = new Date(year, month - 1, day + GRADE_SUBMISSION_WINDOW_DAYS);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isEarly = today < unlockDateObj;
  const isClosed = today > closeDateObj;
  const isLocked = isEarly || isClosed;

  const unlockDateStr = `${unlockDateObj.getFullYear()}-${String(unlockDateObj.getMonth() + 1).padStart(2, "0")}-${String(unlockDateObj.getDate()).padStart(2, "0")}`;
  const formattedUnlockDate = unlockDateObj.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const closeDateStr = `${closeDateObj.getFullYear()}-${String(closeDateObj.getMonth() + 1).padStart(2, "0")}-${String(closeDateObj.getDate()).padStart(2, "0")}`;
  const formattedCloseDate = closeDateObj.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  let message = "";
  if (isEarly) {
    message = `Grades can be sent to the adviser starting ${formattedUnlockDate} (${unlockDateStr}).`;
  } else if (isClosed) {
    message = `The submission window for this term closed on ${formattedCloseDate} (${closeDateStr}). Contact an administrator if this grade needs correction.`;
  }

  return {
    isLocked,
    isEarly,
    isClosed,
    unlockDate: unlockDateStr,
    formattedUnlockDate,
    closeDate: closeDateStr,
    formattedCloseDate,
    message,
  };
}

const TeacherGradeView = () => {
  const { section, subject } = useParams<{ section: string; subject: string }>();
  const [gradebook, setGradebook] = useState<StudentGradebookResponse | null>(null);
  const [termSummary, setTermSummary] = useState<TermGradeSummaryResponse | null>(null);
  const [periods, setPeriods] = useState<TermPeriodInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string>("summary");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [refresh, setRefresh] = useState(0);

  const [selectedCategory, setSelectedCategory] = useState<{
    name: string;
    items: GradebookCategoryHeader[];
    studentGrades: { name: string; scores: (number | null)[] }[];
  } | null>(null);
  const [addingCategoryName, setAddingCategoryName] = useState<string | null>(null);
  const [scoringActivity, setScoringActivity] = useState<{
    activityId: number;
    title: string;
    maxScore: number;
  } | null>(null);

  const [sendingAll, setSendingAll] = useState(false);
  const [sendingStudentId, setSendingStudentId] = useState<string | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [forceResendAll, setForceResendAll] = useState(false);
  const [bulkSendSummary, setBulkSendSummary] = useState<BulkSendGradesToAdviserResponse | null>(null);
  const [conflictData, setConflictData] = useState<{
    studentId?: string;
    studentName?: string;
    recomputedGrade: number;
    expectedGrade: number;
    isBulk?: boolean;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const fetchGradebook = () => {
    setRefresh((prev) => prev + 1);
  };

  const activePeriodId = activeTab.startsWith("term-") ? Number(activeTab.split("-")[1]) : null;
  const currentPeriod = periods.find((p) => p.academic_period_id === activePeriodId);
  const timingGate = getTimingGateInfo(currentPeriod);

  const handleSendStudentGrade = async (student: StudentGradebookRow, force = false) => {
    if (!section || !subject || !activePeriodId) return;

    if (timingGate.isLocked) {
      setToastMessage({
        type: "error",
        text: timingGate.message,
      });
      return;
    }

    try {
      setSendingStudentId(student.student_id);
      setToastMessage(null);
      const res = await sendStudentGradeToAdviser(section, subject, student.student_id, {
        academic_period_id: activePeriodId,
        expected_transmuted_grade: student.transmuted_grade,
        force_resend: force,
      });
      const gradeDisplay = student.transmuted_grade ?? student.initial_grade ?? res.transmuted_grade ?? res.final_period_grade;
      if (res.incomplete_components && res.incomplete_components.length > 0) {
        setToastMessage({
          type: "info",
          text: `Official grade (${gradeDisplay}) for ${student.name} sent to adviser (${res.incomplete_components.length} component(s) missing — sent anyway).`,
        });
      } else {
        setToastMessage({
          type: "success",
          text: `Official grade (${gradeDisplay}) for ${student.name} sent to adviser.`,
        });
      }
      fetchGradebook();
    } catch (err: any) {
      if (err.status === 409 || err.data?.conflict) {
        setConflictData({
          studentId: student.student_id,
          studentName: student.name,
          recomputedGrade: err.data?.recomputed_transmuted_grade ?? (err.data?.detail?.recomputed_transmuted_grade ?? 0),
          expectedGrade: err.data?.expected_transmuted_grade ?? (student.transmuted_grade ?? 0),
          isBulk: false,
        });
      } else {
        setToastMessage({
          type: "error",
          text: err.message || "Failed to send grade to adviser.",
        });
      }
    } finally {
      setSendingStudentId(null);
    }
  };

  const handleBulkSend = async (force = false) => {
    if (!section || !subject || !activePeriodId) return;

    if (timingGate.isLocked) {
      setShowBulkConfirm(false);
      setToastMessage({
        type: "error",
        text: timingGate.message,
      });
      return;
    }

    if (raw.length === 0) {
      setShowBulkConfirm(false);
      setToastMessage({
        type: "error",
        text: "Cannot send grades: No students found in this class.",
      });
      return;
    }

    try {
      setSendingAll(true);
      setToastMessage(null);
      const expectedGrades: Record<string, number> = {};
      raw.forEach((s) => {
        if (s.transmuted_grade != null) {
          expectedGrades[s.student_id] = s.transmuted_grade;
        }
      });
      const res = await bulkSendGradesToAdviser(section, subject, activePeriodId, {
        force_resend_all: force,
        expected_student_grades: expectedGrades,
      });
      setShowBulkConfirm(false);
      setBulkSendSummary(res);
      fetchGradebook();
    } catch (err: any) {
      setShowBulkConfirm(false);
      if (err.status === 409 || err.data?.conflict) {
        setConflictData({
          recomputedGrade: 0,
          expectedGrade: 0,
          isBulk: true,
        });
      } else {
        setToastMessage({
          type: "error",
          text: err.message || "Failed to bulk send grades to adviser.",
        });
      }
    } finally {
      setSendingAll(false);
    }
  };

  useEffect(() => {
    if (section && subject) {
      getTeacherAvailablePeriods(Number(section), Number(subject))
        .then((res) => {
          setPeriods(res.periods as unknown as TermPeriodInfo[]);
          if (res.default_academic_period_id) {
            setActiveTab(`term-${res.default_academic_period_id}`);
          } else {
            setActiveTab("summary");
          }
        })
        .catch((err) => console.error("Error loading periods:", err));
    }
  }, [section, subject]);

  useEffect(() => {
    if (!section || !subject || !activeTab) return;
    setLoading(true);

    if (activeTab === "summary") {
      setGradebook(null);
      getTeacherTermSummary(Number(section), Number(subject))
        .then((data) => setTermSummary(data))
        .catch((err) => console.error("Error loading summary:", err))
        .finally(() => setLoading(false));
    } else if (activeTab.startsWith("term-")) {
      setTermSummary(null);
      const periodId = Number(activeTab.split("-")[1]);
      getTeacherGradebook(section, subject, periodId)
        .then((data) => setGradebook(data))
        .catch((err) => console.error("Error loading gradebook:", err))
        .finally(() => setLoading(false));
    }
  }, [section, subject, activeTab, refresh]);

  const cg = gradebook?.classwork?.[0] ?? { writtenWork: [], performanceTask: [], quarterlyAssessment: [], exams: [] };
  const examItems = cg.exams && cg.exams.length > 0 ? cg.exams : (cg.quarterlyAssessment ?? []);
  const raw = gradebook?.studentGrades ?? [];
  const missingComponentsCount = raw.filter((s) => {
    const hasWW = Array.isArray(s.writtenWork) && s.writtenWork.some((x) => x !== null);
    const hasPT = Array.isArray(s.performanceTask) && s.performanceTask.some((x) => x !== null);
    const hasQA = (Array.isArray(s.quarterlyAssessment) && s.quarterlyAssessment.some((x) => x !== null)) || (Array.isArray(s.exams) && s.exams.some((x) => x !== null));
    return !hasWW || !hasPT || !hasQA;
  }).length;
  const completeComponentsCount = raw.length - missingComponentsCount;
  const filtered = raw
    .filter((sg) => sg.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => (sortBy === "name" ? a.name.localeCompare(b.name) : 0));

  const displaySectionName = gradebook?.scope?.section_name ?? termSummary?.scope?.section_name ?? section ?? "Section";
  const displaySubjectName = gradebook?.scope?.subject_name ?? termSummary?.scope?.subject_name ?? subject ?? "Subject";

  const handleExportCSV = () => {
    let csv = "";
    let filename = "";

    if (activeTab === "summary") {
      if (!termSummary) return;
      const headers = ["Gender", "Learner's Name", ...periods.map((p) => p.period_name), "Final Grade", "Remarks"];
      const { males, females } = groupStudentsByGender(termSummary.students);
      const rows = [
        ...males.map((s) => [
          "Male",
          `"${s.name}"`,
          ...periods.map((p) => fmt(s.term_grades[p.academic_period_id])),
          fmt(s.final_grade),
          s.remark || "",
        ]),
        ...females.map((s) => [
          "Female",
          `"${s.name}"`,
          ...periods.map((p) => fmt(s.term_grades[p.academic_period_id])),
          fmt(s.final_grade),
          s.remark || "",
        ]),
      ];
      csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      filename = `${displaySectionName}_${displaySubjectName}_Summary.csv`;
    } else {
      if (!gradebook) return;
      const headers = [
        "Gender",
        "Learner's Name",
        ...cg.writtenWork.map((w) => `WW: ${w.title} (${w.maxScore})`),
        ...cg.performanceTask.map((p) => `PT: ${p.title} (${p.maxScore})`),
        ...examItems.map((q) => `Exam: ${q.title} (${q.maxScore})`),
        "Transmuted Grade",
      ];
      const { males, females } = groupStudentsByGender(raw);
      const rows = [
        ...males.map((sg) => {
          const sgExams = sg.exams && sg.exams.length > 0 ? sg.exams : (sg.quarterlyAssessment ?? []);
          return [
            "Male",
            `"${sg.name}"`,
            ...sg.writtenWork.map((s) => (s !== null && s !== undefined ? s : "")),
            ...sg.performanceTask.map((s) => (s !== null && s !== undefined ? s : "")),
            ...sgExams.map((s) => (s !== null && s !== undefined ? s : "")),
            fmt(sg.transmuted_grade ?? sg.initial_grade),
          ];
        }),
        ...females.map((sg) => {
          const sgExams = sg.exams && sg.exams.length > 0 ? sg.exams : (sg.quarterlyAssessment ?? []);
          return [
            "Female",
            `"${sg.name}"`,
            ...sg.writtenWork.map((s) => (s !== null && s !== undefined ? s : "")),
            ...sg.performanceTask.map((s) => (s !== null && s !== undefined ? s : "")),
            ...sgExams.map((s) => (s !== null && s !== undefined ? s : "")),
            fmt(sg.transmuted_grade ?? sg.initial_grade),
          ];
        }),
      ];
      csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const activePeriodName = periods.find((p) => `term-${p.academic_period_id}` === activeTab)?.period_name || "Term";
      filename = `${displaySectionName}_${displaySubjectName}_${activePeriodName}.csv`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderSummaryTable = () => {
    const rawSummary = termSummary?.students ?? [];
    const filteredSummary = rawSummary
      .filter((sg) => sg.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => (sortBy === "name" ? a.name.localeCompare(b.name) : 0));

    const { males, females } = groupStudentsByGender(filteredSummary);

    const renderSummaryGroup = (group: typeof males, label: string) => {
      if (group.length === 0) return null;
      return (
        <>
          <Table.Row className="border-y-2 border-black bg-yellow-50 hover:bg-yellow-100/70">
            <Table.Cell colSpan={periods.length + 3} className="py-1 font-black uppercase text-black">{label}</Table.Cell>
          </Table.Row>
          {group.map((item, idx) => (
            <Table.Row key={item.student_id} className="border-b border-black/10 hover:bg-yellow-50/50">
              <Table.Cell className="max-w-[200px] truncate text-sm font-extrabold text-black" title={item.name}>
                {idx + 1}. {item.name}
              </Table.Cell>
              {periods.map((p) => {
                const grade = item.term_grades[p.academic_period_id];
                return (
                  <Table.Cell key={p.academic_period_id} className="text-center tabular-nums">
                    {grade !== undefined && grade !== null ? grade.toFixed(1) : "—"}
                  </Table.Cell>
                );
              })}
              <Table.Cell className="text-center font-bold tabular-nums">
                {item.final_grade !== null ? item.final_grade.toFixed(1) : "—"}
              </Table.Cell>
              <Table.Cell className={`text-center font-bold ${item.remark === 'PASSED' ? 'text-green-600' : item.remark === 'FAILED' ? 'text-red-600' : 'text-yellow-600'}`}>
                {item.remark || "—"}
              </Table.Cell>
            </Table.Row>
          ))}
        </>
      );
    };

    return (
      <Table className="w-full border-collapse text-sm">
        <Table.Header className="border-b-2 border-black bg-yellow-300 text-xs font-black uppercase">
          <Table.Row>
            <Table.Head className="min-w-[200px] font-black text-black">Learner's Name</Table.Head>
            {periods.map((p) => (
              <Table.Head key={p.academic_period_id} className="text-center font-black text-black">
                {p.period_name}
              </Table.Head>
            ))}
            <Table.Head className="text-center font-black text-black">Final Grade</Table.Head>
            <Table.Head className="text-center font-black text-black">Remarks</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell colSpan={periods.length + 3} className="py-8 text-center font-bold italic text-gray-500">
                Loading summary...
              </Table.Cell>
            </Table.Row>
          ) : filteredSummary.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={periods.length + 3} className="py-8 text-center font-bold italic text-gray-500">
                No student records found.
              </Table.Cell>
            </Table.Row>
          ) : (
            <>
              {renderSummaryGroup(males, "Male")}
              {renderSummaryGroup(females, "Female")}
            </>
          )}
        </Table.Body>
      </Table>
    );
  };

  const renderTermTable = () => {
    const { males, females } = groupStudentsByGender(filtered);

    const renderTermGroup = (group: typeof males, label: string) => {
      if (group.length === 0) return null;
      return (
        <>
          <Table.Row className="border-y-2 border-black bg-yellow-50 hover:bg-yellow-100/70">
            <Table.Cell colSpan={6} className="py-1 font-black uppercase text-black">{label}</Table.Cell>
          </Table.Row>
          {group.map((item, idx) => (
            <Table.Row key={item.student_id} className="border-b border-black/10 hover:bg-yellow-50/50">
              <Table.Cell className="max-w-[200px] truncate text-sm font-extrabold text-black" title={item.name}>
                {idx + 1}. {item.name}
              </Table.Cell>

              <Table.Cell className="font-medium py-2.5 px-2">
                <div className="flex flex-row items-center justify-between gap-1 w-full">
                  <div className="size-4 shrink-0" />
                  <div className="flex flex-row justify-around w-full text-xs">
                    {getLatestTwo(item.writtenWork).map(({ item: score }, i) => (
                      <span className="w-full text-center tabular-nums" key={i}>
                        {score !== null && score !== undefined ? score : "—"}
                      </span>
                    ))}
                  </div>
                  <div className="size-4 shrink-0" />
                </div>
              </Table.Cell>

              <Table.Cell className="font-medium py-2.5 px-2">
                <div className="flex flex-row items-center justify-between gap-1 w-full">
                  <div className="size-4 shrink-0" />
                  <div className="flex flex-row justify-around w-full text-xs">
                    {getLatestTwo(item.performanceTask).map(({ item: score }, i) => (
                      <span className="w-full text-center tabular-nums" key={i}>
                        {score !== null && score !== undefined ? score : "—"}
                      </span>
                    ))}
                  </div>
                  <div className="size-4 shrink-0" />
                </div>
              </Table.Cell>

              <Table.Cell className="font-medium py-2.5 px-2">
                <div className="flex flex-row items-center justify-between gap-1 w-full">
                  <div className="size-4 shrink-0" />
                  <div className="flex flex-row justify-around w-full text-xs">
                    {getLatestTwo(item.exams && item.exams.length > 0 ? item.exams : (item.quarterlyAssessment ?? [])).map(({ item: score }, i) => (
                      <span className="w-full text-center tabular-nums" key={i}>
                        {score !== null && score !== undefined ? score : "—"}
                      </span>
                    ))}
                  </div>
                  <div className="size-4 shrink-0" />
                </div>
              </Table.Cell>

              <Table.Cell className="font-medium text-center tabular-nums">
                {item.transmuted_grade != null
                  ? item.transmuted_grade.toFixed(1)
                  : item.initial_grade != null
                    ? item.initial_grade.toFixed(1)
                    : "—"}
              </Table.Cell>

              <Table.Cell className="font-medium text-center py-2 px-2">
                {item.is_finalized ? (
                  <div
                    className="inline-flex items-center justify-center gap-1.5"
                    title={`Sent by ${item.finalized_by_name || 'Teacher'} on ${item.finalized_at ? new Date(item.finalized_at).toLocaleDateString() : 'N/A'}`}
                  >
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-200 text-emerald-950 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                      <CheckCircle2 className="size-3 text-emerald-950" />
                      Sent
                    </span>
                    {!isViewOnly && (
                      <button
                        type="button"
                        title="Resend updated grade to Adviser"
                        disabled={sendingStudentId === item.student_id}
                        onClick={() => handleSendStudentGrade(item, true)}
                        className="text-xs text-black hover:text-black font-bold underline ml-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {sendingStudentId === item.student_id ? <Loader2 className="size-3 animate-spin inline" /> : "Resend"}
                      </button>
                    )}
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2.5 font-bold border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-100"
                    disabled={isViewOnly || sendingStudentId === item.student_id}
                    onClick={() => handleSendStudentGrade(item)}
                    title={
                      timingGate.isLocked
                        ? timingGate.message
                        : "Send finalized grade to class adviser"
                    }
                  >
                    {sendingStudentId === item.student_id ? (
                      <Loader2 className="size-3 animate-spin mr-1" />
                    ) : (
                      <Send className="size-3 mr-1" />
                    )}
                    Send
                  </Button>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </>
      );
    };

    return (
      <Table className="w-full border-collapse text-sm">
        <Table.Header className="border-b-2 border-black bg-yellow-300 text-xs font-black uppercase">
          <Table.Row>
            <Table.Head className="w-[18%] font-black text-black">Learner's Name</Table.Head>
            <Table.Head
              className="w-[25%] cursor-pointer text-center font-black text-black transition-colors hover:bg-yellow-200"
              title="Click to view full Written Works breakdown"
              onClick={() =>
                setSelectedCategory({
                  name: "Written Works",
                  items: cg.writtenWork,
                  studentGrades: filtered.map((sg) => ({
                    name: sg.name,
                    scores: sg.writtenWork,
                    gender: sg.gender,
                  })),
                })
              }
            >
              Written Works
            </Table.Head>
            <Table.Head
              className="w-[25%] cursor-pointer text-center font-black text-black transition-colors hover:bg-yellow-200"
              title="Click to view full Performance Tasks breakdown"
              onClick={() =>
                setSelectedCategory({
                  name: "Performance Tasks",
                  items: cg.performanceTask,
                  studentGrades: filtered.map((sg) => ({
                    name: sg.name,
                    scores: sg.performanceTask,
                    gender: sg.gender,
                  })),
                })
              }
            >
              Performance Task
            </Table.Head>
            <Table.Head
              className="w-[12%] cursor-pointer text-center font-black text-black transition-colors hover:bg-yellow-200"
              title="Click to view full Exams breakdown"
              onClick={() =>
                setSelectedCategory({
                  name: "Exams",
                  items: examItems,
                  studentGrades: filtered.map((sg) => ({
                    name: sg.name,
                    scores: sg.exams && sg.exams.length > 0 ? sg.exams : (sg.quarterlyAssessment ?? []),
                    gender: sg.gender,
                  })),
                })
              }
            >
              Exams
            </Table.Head>
            <Table.Head className="w-[8%] text-center font-black text-black">Grade</Table.Head>
            <Table.Head className="w-[12%] text-center font-black text-black">Adviser Status</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row className="border-b-2 border-black bg-yellow-50 hover:bg-yellow-100/70">
            <Table.Cell className="font-black text-black">Classwork Name</Table.Cell>
            <Table.Cell className="py-2 px-2">
              <div className="flex flex-row items-center justify-between gap-1 w-full">
                <button
                  type="button"
                  title="View all Written Works scores"
                  onClick={() =>
                    setSelectedCategory({
                      name: "Written Works",
                      items: cg.writtenWork,
                      studentGrades: filtered.map((sg) => ({ name: sg.name, scores: sg.writtenWork, gender: sg.gender })),
                    })
                  }
                >
                  <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                </button>
                <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                  {getLatestTwo(cg.writtenWork).map(({ item }) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`flex flex-row items-center gap-1 whitespace-nowrap truncate transition-colors ${isViewOnly ? "cursor-default" : "hover:text-primary cursor-pointer"
                        }`}
                      title={isViewOnly ? item.title : `Click to Enter Scores for ${item.title}`}
                      onClick={() => !isViewOnly && setScoringActivity({ activityId: item.id, title: item.title, maxScore: item.maxScore })}
                    >
                      <span className="truncate max-w-[90px] font-semibold">{item.title}</span>
                      <span className="text-muted-foreground font-normal">({item.maxScore})</span>
                    </button>
                  ))}
                </div>
                {!isViewOnly && (
                  <button
                    type="button"
                    title="Add score to Written Works"
                    onClick={() => setAddingCategoryName("Written Works")}
                  >
                    <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                  </button>
                )}
              </div>
            </Table.Cell>
            <Table.Cell className="py-2 px-2">
              <div className="flex flex-row items-center justify-between gap-1 w-full">
                <button
                  type="button"
                  title="View all Performance Tasks scores"
                  onClick={() =>
                    setSelectedCategory({
                      name: "Performance Tasks",
                      items: cg.performanceTask,
                      studentGrades: filtered.map((sg) => ({ name: sg.name, scores: sg.performanceTask, gender: sg.gender })),
                    })
                  }
                >
                  <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                </button>
                <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                  {getLatestTwo(cg.performanceTask).map(({ item }) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`flex flex-row items-center gap-1 whitespace-nowrap truncate transition-colors ${isViewOnly ? "cursor-default" : "hover:text-primary cursor-pointer"
                        }`}
                      title={isViewOnly ? item.title : `Click to Enter Scores for ${item.title}`}
                      onClick={() => !isViewOnly && setScoringActivity({ activityId: item.id, title: item.title, maxScore: item.maxScore })}
                    >
                      <span className="truncate max-w-[90px] font-semibold">{item.title}</span>
                      <span className="text-muted-foreground font-normal">({item.maxScore})</span>
                    </button>
                  ))}
                </div>
                {!isViewOnly && (
                  <button
                    type="button"
                    title="Add score to Performance Tasks"
                    onClick={() => setAddingCategoryName("Performance Tasks")}
                  >
                    <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                  </button>
                )}
              </div>
            </Table.Cell>
            <Table.Cell className="py-2 px-2">
              <div className="flex flex-row items-center justify-between gap-1 w-full">
                <button
                  type="button"
                  title="View all Exams scores"
                  onClick={() =>
                    setSelectedCategory({
                      name: "Exams",
                      items: examItems,
                      studentGrades: filtered.map((sg) => ({
                        name: sg.name,
                        scores: sg.exams && sg.exams.length > 0 ? sg.exams : (sg.quarterlyAssessment ?? []),
                        gender: sg.gender,
                      })),
                    })
                  }
                >
                  <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                </button>
                <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                  {getLatestTwo(examItems).map(({ item }) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`flex flex-row items-center gap-1 whitespace-nowrap truncate transition-colors ${isViewOnly ? "cursor-default" : "hover:text-primary cursor-pointer"
                        }`}
                      title={isViewOnly ? item.title : `Click to Enter Scores for ${item.title}`}
                      onClick={() => !isViewOnly && setScoringActivity({ activityId: item.id, title: item.title, maxScore: item.maxScore })}
                    >
                      <span className="truncate max-w-[90px] font-semibold">{item.title}</span>
                      <span className="text-muted-foreground font-normal">({item.maxScore})</span>
                    </button>
                  ))}
                </div>
                {!isViewOnly && (
                  <button
                    type="button"
                    title="Add score to Exams"
                    onClick={() => setAddingCategoryName("Exams")}
                  >
                    <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                  </button>
                )}
              </div>
            </Table.Cell>
            <Table.Cell className="text-center font-semibold">100</Table.Cell>
            <Table.Cell className="text-center font-bold text-xs text-muted-foreground py-2 px-2">—</Table.Cell>
          </Table.Row>


          {loading ? (
            <Table.Row>
              <Table.Cell colSpan={6} className="py-8 text-center font-bold italic text-gray-500">
                Loading gradebook...
              </Table.Cell>
            </Table.Row>
          ) : filtered.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={6} className="py-8 text-center font-bold italic text-gray-500">
                No student records found.
              </Table.Cell>
            </Table.Row>
          ) : (
            <>
              {renderTermGroup(males, "Male")}
              {renderTermGroup(females, "Female")}
            </>
          )}
        </Table.Body>
      </Table>
    );
  };

  const isViewOnly = Boolean(gradebook?.scope?.is_view_only);
  const isSubstitution = Boolean(gradebook?.scope?.is_substitution);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List className="flex items-center gap-2 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black [&_a]:!text-muted-foreground [&_a]:!text-inherit [&_a]:!font-inherit [&_button]:!text-muted-foreground [&_button]:!text-inherit [&_button]:!font-inherit [&_[aria-current=page]]:!text-black [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!font-extrabold">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link href="/teacher/grades" className="text-2xl md:text-4xl font-bold">
                      Grades
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page>{displaySectionName}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page>{displaySubjectName}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>

              <div className="flex flex-row items-center gap-2 ml-auto">
                {!isViewOnly && activeTab.startsWith("term-") && (
                  <Button
                    variant="default"
                    className="whitespace-nowrap font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-primary hover:bg-primary-hover text-black"
                    onClick={() => setShowBulkConfirm(true)}
                    disabled={sendingAll || filtered.length === 0}
                    title={
                      timingGate.isLocked
                        ? timingGate.message
                        : "Send finalized grades for all students in this section to adviser"
                    }
                  >
                    <Send className="size-4 mr-2" /> Send All to Adviser
                  </Button>
                )}
                <Button variant={"outline"} className="whitespace-nowrap font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-100" onClick={handleExportCSV}>
                  <Download className="size-4 mr-2" /> Export Grades
                </Button>
              </div>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
              {toastMessage && (
              <div
                className={`rounded-md border-2 border-black p-3 flex items-center justify-between text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${toastMessage.type === "success"
                    ? "bg-emerald-100 text-emerald-950"
                    : toastMessage.type === "error"
                      ? "bg-rose-100 text-rose-950"
                      : "bg-yellow-100 text-black"
                  }`}
              >
                <div className="flex items-center gap-2">
                  {toastMessage.type === "success" ? (
                    <CheckCircle2 className="size-4 text-emerald-950" />
                  ) : (
                    <AlertTriangle className="size-4 text-rose-950" />
                  )}
                  <span>{toastMessage.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setToastMessage(null)}
                  className="p-1 hover:bg-black/10 rounded cursor-pointer text-black"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}



            {isViewOnly && (
              <div className="rounded-md border-2 border-black bg-amber-100 p-4 text-black flex items-center gap-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-medium">
                <span className="text-2xl">🔒</span>
                <div>
                  <h4 className="font-black text-sm">Read-Only Mode (On Leave)</h4>
                  <p className="text-xs text-gray-800">
                    You are currently on leave for this class and subject. Records are view-only.
                    {gradebook?.scope?.substitute_name && ` Currently covered by substitute teacher: ${gradebook.scope.substitute_name}.`}
                  </p>
                </div>
              </div>
            )}

            {isSubstitution && (
              <div className="rounded-md border-2 border-black bg-yellow-100 p-3 text-black flex items-center gap-2 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span className="text-base">📋</span>
                <span>
                  You are covering this class as a substitute teacher for {gradebook?.scope?.original_teacher_name || "the original teacher"}. Full grading and attendance permissions are enabled.
                </span>
              </div>
            )}

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="flex flex-col gap-3">
              <section className="flex flex-row justify-between gap-4">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-full pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search student's name"
                  />
                </div>

                <div className="flex flex-row gap-4">
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v)}>
                    <Select.Trigger className="w-full">
                      <Select.Value placeholder="Sort By" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="name">Name</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
              </section>
              <Card className="w-full rounded-none border-2 border-black bg-white p-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                {activeTab === "summary" ? renderSummaryTable() : renderTermTable()}
              </Card>
              <div className="h-24 w-full"></div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 py-4 px-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40 md:pl-[256px]">
        <div className="flex flex-row gap-2 overflow-x-auto px-4 max-w-7xl mx-auto items-center justify-center pb-2">
          {periods.map((p) => (
            <Button
              key={p.academic_period_id}
              variant={activeTab === `term-${p.academic_period_id}` ? "default" : "outline"}
              onClick={() => setActiveTab(`term-${p.academic_period_id}`)}
              className="rounded-full"
            >
              {p.period_name} {p.is_active ? "(Active)" : ""}
            </Button>
          ))}
          <Button
            variant={activeTab === "summary" ? "default" : "outline"}
            onClick={() => setActiveTab("summary")}
            className="rounded-full"
          >
            Summary of Termly Grades
          </Button>
        </div>
      </div>


      <Dialog
        open={selectedCategory !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCategory(null);
        }}
      >
        {selectedCategory && (
          <ViewGradeScoreModal
            categoryName={selectedCategory.name}
            items={selectedCategory.items}
            studentGrades={selectedCategory.studentGrades}
            onEnterScores={(item) => {
              setSelectedCategory(null);
              setScoringActivity({
                activityId: item.id,
                title: item.title,
                maxScore: item.maxScore,
              });
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={addingCategoryName !== null}
        onOpenChange={(open) => {
          if (!open) setAddingCategoryName(null);
        }}
      >
        {addingCategoryName && (
          <AddClassworkScoreModal
            categoryName={addingCategoryName}
            classId={section ? Number(section) : undefined}
            subjectId={subject ? Number(subject) : undefined}
            onSuccess={fetchGradebook}
            onClose={() => setAddingCategoryName(null)}
          />
        )}
      </Dialog>

      <Dialog
        open={scoringActivity !== null}
        onOpenChange={(open) => {
          if (!open) setScoringActivity(null);
        }}
      >
        {scoringActivity && (
          <EnterManualScoresModal
            activityId={scoringActivity.activityId}
            classId={Number(section)}
            activityTitle={scoringActivity.title}
            maxScore={scoringActivity.maxScore}
            onSuccess={fetchGradebook}
            onClose={() => setScoringActivity(null)}
          />
        )}
      </Dialog>

      {/* Bulk Send to Adviser Confirmation Dialog */}
      <Dialog
        open={showBulkConfirm}
        onOpenChange={(open) => {
          if (!open) setShowBulkConfirm(false);
        }}
      >
        <Dialog.Content size="md" className="border-2 border-black bg-white text-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-0 gap-0 max-w-lg rounded-lg overflow-hidden">
          <Dialog.Header className="bg-primary border-b-2 border-black text-black px-5 py-3.5 min-h-0 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-md bg-white border-2 border-black flex items-center justify-center text-black shrink-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                {timingGate.isLocked ? (
                  <AlertTriangle className="size-4 text-black" />
                ) : (
                  <Send className="size-4 text-black" />
                )}
              </div>
              <h3 className="font-extrabold text-base text-black leading-none font-head">
                {timingGate.isLocked
                  ? timingGate.isClosed
                    ? "Submission Window Closed"
                    : "Submission Window Not Yet Open"
                  : "Send Finalized Grades to Adviser"}
              </h3>
            </div>
          </Dialog.Header>
          <div className="flex flex-col gap-4 p-5 text-sm bg-white text-black">
            <p className="text-gray-800 text-sm leading-relaxed font-medium">
              This will compute and transmit official term grades for all <strong className="text-black font-bold">{raw.length}</strong> enrolled student(s) in{" "}
              <strong className="text-black font-bold">{displaySectionName}</strong> to the class adviser's record.
            </p>

            {timingGate.isLocked ? (
              <div className="rounded-md border-2 border-black bg-amber-100 p-3.5 flex items-center gap-3 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-amber-950">
                <AlertTriangle className="size-5 shrink-0 text-amber-900" />
                <div>
                  <div className="font-black text-sm">
                    {timingGate.isClosed ? "Submission Window Closed" : "Submission Window Not Yet Open"}
                  </div>
                  <div className="font-medium text-xs mt-0.5">
                    {timingGate.isClosed ? (
                      <>
                        The submission window for this term closed on <strong>{timingGate.formattedCloseDate} ({timingGate.closeDate})</strong> (7 days after the term ended on {currentPeriod?.end_date}). Contact an administrator if this grade needs correction.
                      </>
                    ) : (
                      <>
                        Grades can only be sent to the adviser starting on <strong>{timingGate.formattedUnlockDate} ({timingGate.unlockDate})</strong> (7 days before the term ends on {currentPeriod?.end_date}).
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="bg-emerald-50 border-2 border-black rounded-md p-2.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <span className="block text-xl font-black text-emerald-950">{completeComponentsCount}</span>
                    <span className="text-[10px] text-emerald-900 font-bold uppercase tracking-wider">All Components Complete</span>
                  </div>
                  <div className={`border-2 border-black rounded-md p-2.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${missingComponentsCount > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                    <span className={`block text-xl font-black ${missingComponentsCount > 0 ? "text-amber-950" : "text-gray-600"}`}>{missingComponentsCount}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${missingComponentsCount > 0 ? "text-amber-900" : "text-gray-600"}`}>Missing Components (Sending Anyway)</span>
                  </div>
                </div>

                {missingComponentsCount > 0 && (
                  <div className="rounded-md border-2 border-black bg-amber-50 p-3 flex items-center gap-2.5 text-xs text-amber-950 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] font-medium">
                    <AlertTriangle className="size-4 shrink-0 text-amber-900" />
                    <span>
                      <strong>{missingComponentsCount} student(s)</strong> have unassigned or unscored categories. Their grades will be finalized and sent based on available scores.
                    </span>
                  </div>
                )}

                <div className="rounded-md border-2 border-black bg-yellow-50 p-3 flex flex-col gap-1 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  <div className="font-black text-black flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-black shrink-0" />
                    <span>Audit Trail & Idempotency</span>
                  </div>
                  <p className="text-gray-700 leading-relaxed pl-6 text-xs font-medium">
                    Unchanged student grades will be safely skipped. Any updated scores will update the adviser's record and append a timestamped submission log.
                  </p>
                </div>

                <label className="flex items-center gap-2.5 text-xs font-bold text-black cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={forceResendAll}
                    onChange={(e) => setForceResendAll(e.target.checked)}
                    className="size-4 rounded-none border-2 border-black accent-black cursor-pointer"
                  />
                  <span>Force resend all students (even if scores are unchanged)</span>
                </label>
              </>
            )}
          </div>
          <Dialog.Footer className="border-t-2 border-black bg-white px-5 py-3.5 flex justify-end gap-2.5">
            <Button
              variant="outline"
              onClick={() => setShowBulkConfirm(false)}
              disabled={sendingAll}
              className="h-9 px-4 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-100"
            >
              {timingGate.isLocked ? "Close" : "Cancel"}
            </Button>
            {!timingGate.isLocked && raw.length > 0 && (
              <Button
                variant="default"
                onClick={() => handleBulkSend(forceResendAll)}
                disabled={sendingAll}
                className="h-9 px-4 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-primary hover:bg-primary-hover text-black"
              >
                {sendingAll ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" /> Sending...
                  </>
                ) : (
                  <>
                    <Send className="size-3.5 mr-1.5" /> Confirm & Send ({raw.length})
                  </>
                )}
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Stale Data Conflict Modal */}
      <Dialog
        open={conflictData !== null}
        onOpenChange={(open) => {
          if (!open) setConflictData(null);
        }}
      >
        <Dialog.Content size="md" className="border-2 border-black bg-white text-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-0 gap-0 max-w-lg rounded-lg overflow-hidden">
          <Dialog.Header className="bg-primary border-b-2 border-black text-black px-5 py-3.5 min-h-0 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-md bg-white border-2 border-black flex items-center justify-center text-black shrink-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                <AlertTriangle className="size-4 text-black" />
              </div>
              <h3 className="font-extrabold text-base text-black leading-none font-head">
                Grade Discrepancy Detected
              </h3>
            </div>
          </Dialog.Header>
          <div className="flex flex-col gap-4 p-5 text-sm bg-white text-black">
            <p className="text-gray-800 text-sm leading-relaxed font-medium">
              Scores have changed since this page was loaded for{" "}
              <strong className="text-black font-bold">{conflictData?.studentName || "one or more students"}</strong>.
            </p>
            <div className="rounded-md border-2 border-black bg-amber-50 p-3.5 flex flex-col gap-2.5 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex justify-between items-center">
                <span className="text-gray-700 font-bold">Displayed Grade:</span>
                <span className="font-black text-black text-sm">{conflictData?.expectedGrade?.toFixed(1) ?? "—"}</span>
              </div>
              <div className="flex justify-between items-center border-t border-black/10 pt-2">
                <span className="text-gray-700 font-bold">Recomputed Grade:</span>
                <span className="font-black text-emerald-800 text-sm">{conflictData?.recomputedGrade?.toFixed(1) ?? "—"}</span>
              </div>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed font-medium">
              Would you like to refresh your gradebook to review the latest scores, or force-send with the recomputed value?
            </p>
          </div>
          <Dialog.Footer className="border-t-2 border-black bg-white px-5 py-3.5 flex justify-end gap-2.5">
            <Button
              variant="outline"
              onClick={() => {
                setConflictData(null);
                fetchGradebook();
              }}
              className="h-9 px-4 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-100"
            >
              <RefreshCw className="size-3.5 mr-1.5" /> Refresh Gradebook
            </Button>
            <Button
              variant="default"
              onClick={() => {
                const c = conflictData;
                setConflictData(null);
                if (c?.studentId) {
                  const studentObj = filtered.find((s) => s.student_id === c.studentId);
                  if (studentObj) handleSendStudentGrade(studentObj, true);
                } else {
                  handleBulkSend(true);
                }
              }}
              className="h-9 px-4 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-primary hover:bg-primary-hover text-black"
            >
              Send Recomputed Grade
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Bulk Send Summary Result Modal */}
      <Dialog
        open={bulkSendSummary !== null}
        onOpenChange={(open) => {
          if (!open) setBulkSendSummary(null);
        }}
      >
        <Dialog.Content size="md" className="border-2 border-black bg-white text-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-0 gap-0 max-w-lg rounded-lg overflow-hidden">
          <Dialog.Header className="bg-primary border-b-2 border-black text-black px-5 py-3.5 min-h-0 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-md bg-white border-2 border-black flex items-center justify-center text-black shrink-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                <CheckCircle2 className="size-4 text-black" />
              </div>
              <h3 className="font-extrabold text-base text-black leading-none font-head">
                {bulkSendSummary && bulkSendSummary.newly_sent_count > 0
                  ? "Transmission Completed"
                  : bulkSendSummary && bulkSendSummary.unchanged_skipped_count > 0
                    ? "Grades Already Up to Date"
                    : "Transmission Finished"}
              </h3>
            </div>
          </Dialog.Header>
          <div className="flex flex-col gap-4 p-5 text-sm bg-white text-black">
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="bg-emerald-100 border-2 border-black rounded-md p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span className="block text-2xl font-black text-emerald-950">{bulkSendSummary?.newly_sent_count ?? 0}</span>
                <span className="text-[11px] text-emerald-900 font-black uppercase tracking-wider">Sent / Updated</span>
              </div>
              <div className="bg-yellow-50 border-2 border-black rounded-md p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span className="block text-2xl font-black text-black">{bulkSendSummary?.unchanged_skipped_count ?? 0}</span>
                <span className="text-[11px] text-gray-800 font-black uppercase tracking-wider">Unchanged</span>
              </div>
              <div className="bg-amber-100 border-2 border-black rounded-md p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span className="block text-2xl font-black text-amber-950">{(bulkSendSummary?.incomplete_warning_count ?? 0) || (bulkSendSummary?.incomplete_skipped_count ?? 0)}</span>
                <span className="text-[11px] text-amber-900 font-black uppercase tracking-wider">With Warnings</span>
              </div>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed font-medium">
              {bulkSendSummary && (bulkSendSummary.incomplete_warning_count ?? 0) > 0
                ? `Official grades and append-only audit logs are now updated in the adviser's record (${bulkSendSummary.incomplete_warning_count} student(s) transmitted with missing classwork components).`
                : bulkSendSummary && bulkSendSummary.newly_sent_count > 0
                  ? "Official grades and append-only audit logs are now updated in the adviser's record."
                  : "All student grades were already transmitted to the adviser with matching scores. No changes were necessary."}
            </p>
          </div>
          <Dialog.Footer className="border-t-2 border-black bg-white px-5 py-3.5 flex justify-end">
            <Button
              variant="default"
              onClick={() => setBulkSendSummary(null)}
              className="h-9 px-5 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-primary hover:bg-primary-hover text-black"
            >
              Done
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </AppLayout>
  );
};

export default TeacherGradeView;
