import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useParams } from "react-router-dom";
import { Ellipsis, Plus, Search, Download } from "lucide-react";
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
  type StudentGradebookResponse, 
  type GradebookCategoryHeader,
  type TermGradeSummaryResponse,
  type TermPeriodInfo
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

  const fetchGradebook = () => {
    setRefresh((prev) => prev + 1);
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

  const cg = gradebook?.classwork?.[0] ?? { writtenWork: [], performanceTask: [], quarterlyAssessment: [] };
  const raw = gradebook?.studentGrades ?? [];
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
        ...cg.quarterlyAssessment.map((q) => `QA: ${q.title} (${q.maxScore})`),
        "Transmuted Grade",
      ];
      const { males, females } = groupStudentsByGender(raw);
      const rows = [
        ...males.map((sg) => [
          "Male",
          `"${sg.name}"`,
          ...sg.writtenWork.map((s) => (s !== null && s !== undefined ? s : "")),
          ...sg.performanceTask.map((s) => (s !== null && s !== undefined ? s : "")),
          ...sg.quarterlyAssessment.map((s) => (s !== null && s !== undefined ? s : "")),
          fmt(sg.transmuted_grade ?? sg.initial_grade),
        ]),
        ...females.map((sg) => [
          "Female",
          `"${sg.name}"`,
          ...sg.writtenWork.map((s) => (s !== null && s !== undefined ? s : "")),
          ...sg.performanceTask.map((s) => (s !== null && s !== undefined ? s : "")),
          ...sg.quarterlyAssessment.map((s) => (s !== null && s !== undefined ? s : "")),
          fmt(sg.transmuted_grade ?? sg.initial_grade),
        ]),
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
            <Table.Cell colSpan={5} className="py-1 font-black uppercase text-black">{label}</Table.Cell>
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
                    {getLatestTwo(item.quarterlyAssessment).map(({ item: score }, i) => (
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
            </Table.Row>
          ))}
        </>
      );
    };

    return (
      <Table className="w-full border-collapse text-sm">
        <Table.Header className="border-b-2 border-black bg-yellow-300 text-xs font-black uppercase">
          <Table.Row>
            <Table.Head className="w-[22%] font-black text-black">Learner's Name</Table.Head>
            <Table.Head
              className="w-[27%] cursor-pointer text-center font-black text-black transition-colors hover:bg-yellow-200"
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
              className="w-[27%] cursor-pointer text-center font-black text-black transition-colors hover:bg-yellow-200"
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
              className="w-[15%] cursor-pointer text-center font-black text-black transition-colors hover:bg-yellow-200"
              title="Click to view full Quarterly Assessment breakdown"
              onClick={() =>
                setSelectedCategory({
                  name: "Quarterly Assessment",
                  items: cg.quarterlyAssessment,
                  studentGrades: filtered.map((sg) => ({
                    name: sg.name,
                    scores: sg.quarterlyAssessment,
                    gender: sg.gender,
                  })),
                })
              }
            >
              Quarterly Assessment
            </Table.Head>
            <Table.Head className="w-[9%] text-center font-black text-black">Grade</Table.Head>
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
                      className={`flex flex-row items-center gap-1 whitespace-nowrap truncate transition-colors ${
                        isViewOnly ? "cursor-default" : "hover:text-primary cursor-pointer"
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
                      className={`flex flex-row items-center gap-1 whitespace-nowrap truncate transition-colors ${
                        isViewOnly ? "cursor-default" : "hover:text-primary cursor-pointer"
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
                  title="View all Quarterly Assessment scores"
                  onClick={() =>
                    setSelectedCategory({
                      name: "Quarterly Assessment",
                      items: cg.quarterlyAssessment,
                      studentGrades: filtered.map((sg) => ({ name: sg.name, scores: sg.quarterlyAssessment, gender: sg.gender })),
                    })
                  }
                >
                  <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                </button>
                <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                  {getLatestTwo(cg.quarterlyAssessment).map(({ item }) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`flex flex-row items-center gap-1 whitespace-nowrap truncate transition-colors ${
                        isViewOnly ? "cursor-default" : "hover:text-primary cursor-pointer"
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
                    title="Add score to Quarterly Assessment"
                    onClick={() => setAddingCategoryName("Quarterly Assessment")}
                  >
                    <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                  </button>
                )}
              </div>
            </Table.Cell>
            <Table.Cell className="text-center font-semibold">100</Table.Cell>
          </Table.Row>


          {loading ? (
            <Table.Row>
              <Table.Cell colSpan={5} className="py-8 text-center font-bold italic text-gray-500">
                Loading gradebook...
              </Table.Cell>
            </Table.Row>
          ) : filtered.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={5} className="py-8 text-center font-bold italic text-gray-500">
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
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3">
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

              <div className="flex flex-row gap-2 ml-auto">
                <Button variant={"outline"} className="whitespace-nowrap" onClick={handleExportCSV}>
                  <Download className="size-4 mr-2" /> Export Grades
                </Button>
              </div>
            </header>

            {isViewOnly && (
              <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4 text-amber-900 dark:text-amber-200 flex items-center gap-3 shadow-sm">
                <span className="text-2xl">🔒</span>
                <div>
                  <h4 className="font-bold text-sm">Read-Only Mode (On Leave)</h4>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    You are currently on leave for this class and subject. Records are view-only.
                    {gradebook?.scope?.substitute_name && ` Currently covered by substitute teacher: ${gradebook.scope.substitute_name}.`}
                  </p>
                </div>
              </div>
            )}

            {isSubstitution && (
              <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200 flex items-center gap-2 text-xs font-semibold shadow-sm">
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
    </AppLayout>
  );
};

export default TeacherGradeView;
