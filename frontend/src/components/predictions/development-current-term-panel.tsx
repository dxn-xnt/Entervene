import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Eye, Search } from "lucide-react";
import { getClasses, getClassStudents, getSubjects } from "@/lib/api";
import type { ClassListItem, ClassStudentListItem } from "@/types/adminClasses";
import type { SubjectListItem } from "@/lib/api";
import {
  generateDevelopmentCurrentTermPrediction,
  fetchDevelopmentCurrentTermPredictions,
  fetchDashboardFilters,
  type DashboardClassOption,
  type DashboardSubjectOption,
  type DashboardTermOption,
  type DevelopmentCurrentTermListItem,
  type DevelopmentCurrentTermResponse,
  type DevelopmentInterventionLevel,
} from "@/lib/prediction-api";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { BLOCKED_MESSAGES, INTERVENTION_LABELS } from "./development-current-term-contract";

function InterventionBadge({ level }: { level: DevelopmentInterventionLevel }) {
  const colors: Record<DevelopmentInterventionLevel, string> = {
    HIGH_RISK: "bg-red-500 text-white",
    MODERATE_RISK: "bg-amber-500 text-white",
    NEEDS_MONITORING: "bg-yellow-400 text-black",
    LOW_RISK: "bg-emerald-500 text-white",
  };
  return <Badge size="sm" variant="surface" className={`${colors[level]} border-2 border-black font-bold`}>{INTERVENTION_LABELS[level]}</Badge>;
}

export default function DevelopmentCurrentTermPanel({ periodId, termName, role }: { periodId: number | null; termName: string; role: "admin" | "teacher" }) {
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [teacherClasses, setTeacherClasses] = useState<DashboardClassOption[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<DashboardSubjectOption[]>([]);
  const [teacherTerms, setTeacherTerms] = useState<DashboardTermOption[]>([]);
  const [teacherPeriodId, setTeacherPeriodId] = useState<number | null>(periodId);
  const [students, setStudents] = useState<ClassStudentListItem[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [studentId, setStudentId] = useState("");
  const [studentLookup, setStudentLookup] = useState("");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<DevelopmentInterventionLevel | "all">("all");
  const [rows, setRows] = useState<DevelopmentCurrentTermListItem[]>([]);
  const [selected, setSelected] = useState<DevelopmentCurrentTermListItem | null>(null);
  const [blocked, setBlocked] = useState<DevelopmentCurrentTermResponse | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const [error, setError] = useState("");
  const [loadingScope, setLoadingScope] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [readError, setReadError] = useState("");
  const [generating, setGenerating] = useState(false);
  const inFlight = useRef(false);
  const readRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const request = role === "admin"
      ? Promise.all([getClasses(), getSubjects({ status: "active" })]).then(([classData, subjectData]) => {
          if (!cancelled) {
            setClasses(classData.classes);
            setSubjects(subjectData.subjects);
          }
        })
      : fetchDashboardFilters().then((scope) => {
          if (!cancelled) {
            setTeacherClasses(scope.classes);
            setTeacherTerms(scope.terms);
            setTeacherPeriodId((current) => {
              const preferred = current ?? periodId;
              return preferred !== null && scope.terms.some((item) => item.academic_period_id === preferred)
                ? preferred
                : null;
            });
          }
        });
    request
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load prediction scope."); })
      .finally(() => { if (!cancelled) setLoadingScope(false); });
    return () => { cancelled = true; };
  }, [periodId, role]);

  const activePeriodId = role === "teacher" ? teacherPeriodId : periodId;
  const selectedGrade = role === "admin"
    ? classes.find((item) => item.class_id === classId)?.academic_level.grade_level
    : teacherClasses.find((item) => item.class_id === classId)?.grade_level;
  const unsupportedGrade = selectedGrade != null && (selectedGrade < 7 || selectedGrade > 10);

  useEffect(() => {
    if (role !== "teacher" || classId === null || activePeriodId === null) {
      setTeacherSubjects([]);
      return;
    }
    let cancelled = false;
    setLoadingSubjects(true);
    fetchDashboardFilters({ class_id: classId, academic_period_id: activePeriodId })
      .then((scope) => { if (!cancelled) setTeacherSubjects(scope.subjects); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load assigned subjects."); })
      .finally(() => { if (!cancelled) setLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [activePeriodId, classId, role]);

  useEffect(() => {
    if (role !== "admin" || classId === null) { setStudents([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoadingStudents(true);
      getClassStudents(classId, { search: studentLookup, pageSize: 50 })
        .then((response) => { if (!cancelled) setStudents(response.students); })
        .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load students."); })
        .finally(() => { if (!cancelled) setLoadingStudents(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [classId, role, studentLookup]);

  const loadPredictions = useCallback(async () => {
    if (classId === null || subjectId === null || activePeriodId === null || unsupportedGrade) return;
    const requestId = ++readRequestId.current;
    setLoadingPredictions(true);
    setReadError("");
    try {
      const response = await fetchDevelopmentCurrentTermPredictions({
        class_id: classId,
        subject_id: subjectId,
        academic_period_id: activePeriodId,
      }, role);
      if (readRequestId.current === requestId) setRows(response.items);
    } catch (cause) {
      if (readRequestId.current === requestId) {
        setRows([]);
        setReadError(cause instanceof Error ? cause.message : "Unable to load development predictions.");
      }
    } finally {
      if (readRequestId.current === requestId) setLoadingPredictions(false);
    }
  }, [activePeriodId, classId, role, subjectId, unsupportedGrade]);

  useEffect(() => {
    if (classId === null || subjectId === null || activePeriodId === null || unsupportedGrade) {
      readRequestId.current += 1;
      setRows([]);
      setReadError("");
      setLoadingPredictions(false);
      return;
    }
    void loadPredictions();
    return () => { readRequestId.current += 1; };
  }, [activePeriodId, classId, loadPredictions, subjectId, unsupportedGrade]);

  const chosenAdminClass = classes.find((item) => item.class_id === classId);
  const chosenSubject = role === "admin"
    ? subjects.find((item) => item.subject_id === subjectId)
    : teacherSubjects.find((item) => item.subject_id === subjectId);
  const classOptions = role === "admin" ? classes : teacherClasses;
  const availableSubjects = role === "admin"
    ? subjects.filter((item) => item.academic_level.academic_level_id === chosenAdminClass?.academic_level.academic_level_id)
    : teacherSubjects;
  const selectedTeacherClass = teacherClasses.find((item) => item.class_id === classId);
  const gradeLevelName = role === "admin"
    ? chosenAdminClass?.academic_level.level_name
    : selectedTeacherClass?.grade_level ? `Grade ${selectedTeacherClass.grade_level}` : undefined;
  const activeTermName = role === "teacher"
    ? teacherTerms.find((item) => item.academic_period_id === activePeriodId)?.term_label || "Current Term"
    : termName;
  const visibleRows = useMemo(() => rows.filter((row) =>
    (levelFilter === "all" || row.intervention_level === levelFilter) &&
    ((row.student_name || row.student_id).toLowerCase().includes(search.trim().toLowerCase()) || row.student_id.toLowerCase().includes(search.trim().toLowerCase()))
  ), [rows, levelFilter, search]);

  async function generate() {
    if (role !== "admin" || unsupportedGrade || inFlight.current || generating || !studentId || !classId || !subjectId || !activePeriodId || !chosenAdminClass || !chosenSubject) return;
    inFlight.current = true;
    setGenerating(true);
    setError("");
    setBlocked(null);
    setUnchanged(false);
    try {
      const result = await generateDevelopmentCurrentTermPrediction({
        student_id: studentId,
        class_id: classId,
        subject_id: subjectId,
        source_period_id: activePeriodId,
      }, role);
      if (result.unchanged) {
        setUnchanged(true);
        await loadPredictions();
        return;
      }
      if (!result.persisted) {
        setBlocked(result);
        return;
      }
      await loadPredictions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate a development prediction.");
    } finally {
      inFlight.current = false;
      setGenerating(false);
    }
  }

  return (
    <div className="-mt-[1px] min-w-0 space-y-5 border-t-2 border-border px-3 py-4 sm:px-4 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Current-Term Projections</h2>
        <Badge size="sm" variant="surface">Development</Badge>
        <span className="text-xs text-muted-foreground">Development model, not yet production validated.</span>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b-2 border-border pb-5">
        {role === "teacher" && <div className="w-full sm:w-44">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-period">Academic term</label>
          <Select value={teacherPeriodId === null ? "none" : String(teacherPeriodId)} onValueChange={(value) => {
            setTeacherPeriodId(value === "none" ? null : Number(value)); setClassId(null); setSubjectId(null); setSelected(null);
          }}>
            <Select.Trigger id="dev-period" className="w-full bg-white"><Select.Value placeholder="Select term" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select term</Select.Item>{teacherTerms.map((item) => <Select.Item key={item.academic_period_id} value={String(item.academic_period_id)}>{item.term_label}</Select.Item>)}</Select.Content>
          </Select>
        </div>}
        <div className="w-full sm:w-44">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-class">Class</label>
          <Select value={classId === null ? "none" : String(classId)} onValueChange={(value) => {
            setClassId(value === "none" ? null : Number(value)); setSubjectId(null); setStudentId(""); setStudentLookup(""); setBlocked(null);
          }} disabled={role === "teacher" && activePeriodId === null}>
            <Select.Trigger id="dev-class" className="w-full bg-white"><Select.Value placeholder="Select class" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select class</Select.Item>{classOptions.map((item) => <Select.Item key={item.class_id} value={String(item.class_id)}>{item.section_name}</Select.Item>)}</Select.Content>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-subject">Subject</label>
          <Select value={subjectId === null ? "none" : String(subjectId)} onValueChange={(value) => { setSubjectId(value === "none" ? null : Number(value)); setBlocked(null); }} disabled={!classId || loadingSubjects}>
            <Select.Trigger id="dev-subject" className="w-full bg-white"><Select.Value placeholder="Select subject" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select subject</Select.Item>{availableSubjects.map((item) => <Select.Item key={item.subject_id} value={String(item.subject_id)}>{item.subject_name}</Select.Item>)}</Select.Content>
          </Select>
        </div>
        {role === "admin" && <div className="w-full sm:w-48">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-student-search">Find student</label>
          <Input id="dev-student-search" value={studentLookup} onChange={(event) => { setStudentLookup(event.target.value); setStudentId(""); }} disabled={!classId} placeholder="Search class students" />
        </div>}
        {role === "admin" && <div className="w-full sm:w-52">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-student">Student</label>
          <Select value={studentId || "none"} onValueChange={(value) => { setStudentId(value === "none" ? "" : value); setBlocked(null); }} disabled={!classId || loadingStudents}>
            <Select.Trigger id="dev-student" className="w-full bg-white"><Select.Value placeholder="Select student" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select student</Select.Item>{students.map((item) => <Select.Item key={item.student_id} value={item.student_id}>{item.full_name}</Select.Item>)}</Select.Content>
          </Select>
        </div>}
        {role === "admin" && <Button onClick={generate} disabled={unsupportedGrade || loadingScope || generating || !classId || !subjectId || !studentId || !activePeriodId} className="shrink-0">
          {generating ? "Generating..." : "Generate Projection"}
        </Button>}
      </div>
      {!activePeriodId && <p className="text-sm text-muted-foreground">Select an academic term to view current-term projections.</p>}
      {unsupportedGrade && <p role="status" className="border-2 border-blue-700 bg-blue-50 p-3 text-sm font-semibold">AI grade projection is not yet available for this grade level. This grade level requires additional validated grading and historical data.</p>}
      {error && <Alert status="error" className="flex items-center gap-2 p-3 text-sm"><AlertCircle className="size-4 shrink-0" />{error}</Alert>}
      {readError && <Alert status="error" className="flex items-center gap-2 p-3 text-sm"><AlertCircle className="size-4 shrink-0" />{readError}</Alert>}
      {blocked && <Alert status="warning" className="flex items-start gap-2 p-3 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span><strong>{BLOCKED_MESSAGES[blocked.prediction_status] || "This projection could not be assessed."}</strong>{blocked.reason_codes?.length ? ` (${blocked.reason_codes.join(", ")})` : ""}</span></Alert>}
      {unchanged && <p role="status" className="border border-green-700 bg-green-50 p-3 text-sm">Academic evidence is unchanged. The latest projection was reused; no new revision was created.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full min-w-48 flex-1 sm:max-w-xs"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search generated students" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student" className="pl-9" /></div>
        <Select value={levelFilter} onValueChange={(value) => setLevelFilter(value as DevelopmentInterventionLevel | "all")}>
          <Select.Trigger className="w-full bg-white sm:w-52"><Select.Value placeholder="All Intervention Levels" /></Select.Trigger>
          <Select.Content><Select.Item value="all">All Intervention Levels</Select.Item>{Object.entries(INTERVENTION_LABELS).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content>
        </Select>
      </div>

      {unsupportedGrade ? null : loadingPredictions ? (
        <div aria-label="Loading current-term projections" className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : readError ? null : visibleRows.length === 0 ? (
        <EmptyStateCard icon={<Eye className="size-7" />} title="No current-term projections available" description="No current-term projections available for this scope." />
      ) : (
        <Table wrapperClassName="rounded-none shadow-[3px_3px_0px_#000]" className="min-w-[620px]">
          <Table.Header><Table.Row className="bg-yellow-400 hover:bg-yellow-400"><Table.Head>Student</Table.Head><Table.Head>Projected Final Term Grade</Table.Head><Table.Head>Intervention Level</Table.Head><Table.Head>Action</Table.Head></Table.Row></Table.Header>
          <Table.Body>{visibleRows.map((row) => <Table.Row key={row.prediction_id}>
            <Table.Cell className="font-semibold">{row.student_name || row.student_id}</Table.Cell>
            <Table.Cell className="font-bold">{row.official_final_grade_available || row.term_context?.is_active === false
              ? <>{row.official_final_grade_available && <p>Final Grade: {row.official_final_grade?.toFixed(2) ?? "Not available"}</p>}<p className="text-xs font-normal">Earlier projection: {row.projected_final_term_grade?.toFixed(2)}</p></>
              : row.projected_final_term_grade?.toFixed(2)}</Table.Cell>
            <Table.Cell>{row.official_final_grade_available || row.term_context?.is_active === false ? "Historical projection" : <InterventionBadge level={row.intervention_level} />}</Table.Cell>
            <Table.Cell><Button size="sm" variant="outline" onClick={() => setSelected(row)}><Eye className="size-4" />View Details</Button></Table.Cell>
          </Table.Row>)}</Table.Body>
        </Table>
      )}

      <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader><SheetTitle>Current-Term Projection</SheetTitle><SheetDescription className="sr-only">Student, projected grade, readiness, and academic evidence details.</SheetDescription></SheetHeader>
          {selected && <div className="space-y-4 p-5 text-sm">
            {selected.official_final_grade_available && <div role="status" className="border border-blue-700 bg-blue-50 p-3"><strong>Final Grade: {selected.official_final_grade?.toFixed(2) ?? "Not available"}</strong><p>Earlier Projected Final Term Grade: {selected.projected_final_term_grade?.toFixed(2)}</p><p>This projection is historical and is no longer the current outcome.</p></div>}
            {selected.term_context?.is_active === false && !selected.official_final_grade_available && <p role="status" className="border border-blue-700 bg-blue-50 p-3">This term is no longer active. The projection is historical.</p>}
            <Badge size="sm" variant="surface">Development</Badge>
            <dl className="grid grid-cols-2 gap-3">
              <dt className="text-muted-foreground">Student</dt><dd className="font-semibold">{selected.student_name || selected.student_id}</dd>
              <dt className="text-muted-foreground">Subject</dt><dd>{selected.subject_name}</dd>
              <dt className="text-muted-foreground">Section/Class</dt><dd>{selected.class_name}</dd>
              <dt className="text-muted-foreground">Grade level</dt><dd>{gradeLevelName || "Not available"}</dd>
              <dt className="text-muted-foreground">Academic term</dt><dd>{selected.period_name || activeTermName}</dd>
              <dt className="text-muted-foreground">Projected Final Term Grade</dt><dd className="font-bold">{selected.projected_final_term_grade?.toFixed(2)}</dd>
              <dt className="text-muted-foreground">Intervention Level</dt><dd><InterventionBadge level={selected.intervention_level} /></dd>
              <dt className="text-muted-foreground">Readiness</dt><dd>{selected.readiness_level || selected.readiness_status}</dd>
              <dt className="text-muted-foreground">Generated</dt><dd>{selected.generated_at ? new Date(selected.generated_at).toLocaleString() : "Not available"}</dd>
              <dt className="text-muted-foreground">Revision</dt><dd>{selected.revision}</dd>
            </dl>
            <p>The Random Forest projects the student's final term grade from available current-term academic evidence.</p>
            <p>The intervention level is assigned separately using the school's grade-based intervention rules.</p>
          </div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
