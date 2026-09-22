import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Eye, Search } from "lucide-react";
import { getClasses, getClassStudents, getSubjects } from "@/lib/api";
import type { ClassListItem, ClassStudentListItem } from "@/types/adminClasses";
import type { SubjectListItem } from "@/lib/api";
import {
  generateDevelopmentCurrentTermPrediction,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BLOCKED_MESSAGES, INTERVENTION_LABELS } from "./development-current-term-contract";

type GeneratedRow = {
  result: DevelopmentCurrentTermResponse;
  studentId: string;
  studentName: string;
  className: string;
  subjectName: string;
  gradeLevel: string;
  termName: string;
};

function InterventionBadge({ level }: { level: DevelopmentInterventionLevel }) {
  const colors: Record<DevelopmentInterventionLevel, string> = {
    HIGH_RISK: "bg-red-500 text-white",
    MODERATE_RISK: "bg-amber-500 text-white",
    NEEDS_MONITORING: "bg-yellow-400 text-black",
    LOW_RISK: "bg-emerald-500 text-white",
  };
  return <Badge size="sm" variant="surface" className={`${colors[level]} border-2 border-black font-bold`}>{INTERVENTION_LABELS[level]}</Badge>;
}

export default function DevelopmentCurrentTermPanel({ periodId, termName, role }: { periodId: number | null; termName: string; role: "admin" }) {
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [students, setStudents] = useState<ClassStudentListItem[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [studentId, setStudentId] = useState("");
  const [studentLookup, setStudentLookup] = useState("");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<DevelopmentInterventionLevel | "all">("all");
  const [rows, setRows] = useState<GeneratedRow[]>([]);
  const [selected, setSelected] = useState<GeneratedRow | null>(null);
  const [blocked, setBlocked] = useState<DevelopmentCurrentTermResponse | null>(null);
  const [error, setError] = useState("");
  const [loadingScope, setLoadingScope] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [generating, setGenerating] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getClasses(), getSubjects({ status: "active" })])
      .then(([classData, subjectData]) => {
        if (!cancelled) {
          setClasses(classData.classes);
          setSubjects(subjectData.subjects);
        }
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load prediction scope."); })
      .finally(() => { if (!cancelled) setLoadingScope(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (classId === null) { setStudents([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoadingStudents(true);
      getClassStudents(classId, { search: studentLookup, pageSize: 50 })
        .then((response) => { if (!cancelled) setStudents(response.students); })
        .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load students."); })
        .finally(() => { if (!cancelled) setLoadingStudents(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [classId, studentLookup]);

  const chosenClass = classes.find((item) => item.class_id === classId);
  const chosenSubject = subjects.find((item) => item.subject_id === subjectId);
  const chosenStudent = students.find((item) => item.student_id === studentId);
  const availableSubjects = subjects.filter((item) => item.academic_level.academic_level_id === chosenClass?.academic_level.academic_level_id);
  const visibleRows = useMemo(() => rows.filter((row) =>
    (levelFilter === "all" || row.result.intervention_level === levelFilter) &&
    (row.studentName.toLowerCase().includes(search.trim().toLowerCase()) || row.studentId.toLowerCase().includes(search.trim().toLowerCase()))
  ), [rows, levelFilter, search]);

  async function generate() {
    if (inFlight.current || generating || !studentId || !classId || !subjectId || !periodId || !chosenClass || !chosenSubject) return;
    inFlight.current = true;
    setGenerating(true);
    setError("");
    setBlocked(null);
    try {
      const result = await generateDevelopmentCurrentTermPrediction({
        student_id: studentId,
        class_id: classId,
        subject_id: subjectId,
        source_period_id: periodId,
      }, role);
      if (!result.persisted) {
        setBlocked(result);
        return;
      }
      setRows((previous) => [{
        result,
        studentId,
        studentName: chosenStudent?.full_name || studentId,
        className: chosenClass.section_name,
        subjectName: chosenSubject.subject_name,
        gradeLevel: chosenClass.academic_level.level_name,
        termName,
      }, ...previous]);
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
        <div className="w-full sm:w-44">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-class">Class</label>
          <Select value={classId === null ? "none" : String(classId)} onValueChange={(value) => {
            setClassId(value === "none" ? null : Number(value)); setSubjectId(null); setStudentId(""); setStudentLookup(""); setBlocked(null);
          }}>
            <Select.Trigger id="dev-class" className="w-full bg-white"><Select.Value placeholder="Select class" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select class</Select.Item>{classes.map((item) => <Select.Item key={item.class_id} value={String(item.class_id)}>{item.section_name}</Select.Item>)}</Select.Content>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-subject">Subject</label>
          <Select value={subjectId === null ? "none" : String(subjectId)} onValueChange={(value) => { setSubjectId(value === "none" ? null : Number(value)); setBlocked(null); }} disabled={!classId}>
            <Select.Trigger id="dev-subject" className="w-full bg-white"><Select.Value placeholder="Select subject" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select subject</Select.Item>{availableSubjects.map((item) => <Select.Item key={item.subject_id} value={String(item.subject_id)}>{item.subject_name}</Select.Item>)}</Select.Content>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-student-search">Find student</label>
          <Input id="dev-student-search" value={studentLookup} onChange={(event) => { setStudentLookup(event.target.value); setStudentId(""); }} disabled={!classId} placeholder="Search class students" />
        </div>
        <div className="w-full sm:w-52">
          <label className="mb-1 block text-xs font-bold" htmlFor="dev-student">Student</label>
          <Select value={studentId || "none"} onValueChange={(value) => { setStudentId(value === "none" ? "" : value); setBlocked(null); }} disabled={!classId || loadingStudents}>
            <Select.Trigger id="dev-student" className="w-full bg-white"><Select.Value placeholder="Select student" /></Select.Trigger>
            <Select.Content><Select.Item value="none">Select student</Select.Item>{students.map((item) => <Select.Item key={item.student_id} value={item.student_id}>{item.full_name}</Select.Item>)}</Select.Content>
          </Select>
        </div>
        <Button onClick={generate} disabled={loadingScope || generating || !classId || !subjectId || !studentId || !periodId} className="shrink-0">
          {generating ? "Generating..." : "Generate Projection"}
        </Button>
      </div>
      {!periodId && <p className="text-sm text-muted-foreground">Select an academic term to generate a projection.</p>}
      {error && <Alert status="error" className="flex items-center gap-2 p-3 text-sm"><AlertCircle className="size-4 shrink-0" />{error}</Alert>}
      {blocked && <Alert status="warning" className="flex items-start gap-2 p-3 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span><strong>{BLOCKED_MESSAGES[blocked.prediction_status] || "This projection could not be assessed."}</strong>{blocked.reason_codes?.length ? ` (${blocked.reason_codes.join(", ")})` : ""}</span></Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full min-w-48 flex-1 sm:max-w-xs"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search generated students" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student" className="pl-9" /></div>
        <Select value={levelFilter} onValueChange={(value) => setLevelFilter(value as DevelopmentInterventionLevel | "all")}>
          <Select.Trigger className="w-full bg-white sm:w-52"><Select.Value placeholder="All Intervention Levels" /></Select.Trigger>
          <Select.Content><Select.Item value="all">All Intervention Levels</Select.Item>{Object.entries(INTERVENTION_LABELS).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content>
        </Select>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyStateCard icon={<Eye className="size-7" />} title="No current-term projections available" description="No development predictions match the current scope or filters. Only projections generated in this session appear here." />
      ) : (
        <Table wrapperClassName="rounded-none shadow-[3px_3px_0px_#000]" className="min-w-[620px]">
          <Table.Header><Table.Row className="bg-yellow-400 hover:bg-yellow-400"><Table.Head>Student</Table.Head><Table.Head>Projected Final Term Grade</Table.Head><Table.Head>Intervention Level</Table.Head><Table.Head>Action</Table.Head></Table.Row></Table.Header>
          <Table.Body>{visibleRows.map((row) => <Table.Row key={row.result.prediction_id}>
            <Table.Cell className="font-semibold">{row.studentName}</Table.Cell>
            <Table.Cell className="font-bold">{row.result.projected_final_term_grade?.toFixed(2)}</Table.Cell>
            <Table.Cell><InterventionBadge level={row.result.intervention_level as DevelopmentInterventionLevel} /></Table.Cell>
            <Table.Cell><Button size="sm" variant="outline" onClick={() => setSelected(row)}><Eye className="size-4" />View Details</Button></Table.Cell>
          </Table.Row>)}</Table.Body>
        </Table>
      )}

      <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader><SheetTitle>Current-Term Projection</SheetTitle></SheetHeader>
          {selected && <div className="space-y-4 p-5 text-sm">
            <Badge size="sm" variant="surface">Development</Badge>
            <dl className="grid grid-cols-2 gap-3">
              <dt className="text-muted-foreground">Student</dt><dd className="font-semibold">{selected.studentName}</dd>
              <dt className="text-muted-foreground">Subject</dt><dd>{selected.subjectName}</dd>
              <dt className="text-muted-foreground">Section/Class</dt><dd>{selected.className}</dd>
              <dt className="text-muted-foreground">Grade level</dt><dd>{selected.gradeLevel}</dd>
              <dt className="text-muted-foreground">Academic term</dt><dd>{selected.termName}</dd>
              <dt className="text-muted-foreground">Projected Final Term Grade</dt><dd className="font-bold">{selected.result.projected_final_term_grade?.toFixed(2)}</dd>
              <dt className="text-muted-foreground">Intervention Level</dt><dd><InterventionBadge level={selected.result.intervention_level as DevelopmentInterventionLevel} /></dd>
              <dt className="text-muted-foreground">Readiness</dt><dd>{selected.result.readiness_level || selected.result.readiness_status}</dd>
              <dt className="text-muted-foreground">Generated</dt><dd>{selected.result.generated_at ? new Date(selected.result.generated_at).toLocaleString() : "Not available"}</dd>
              <dt className="text-muted-foreground">Revision</dt><dd>{selected.result.revision}</dd>
            </dl>
            <p>The projected final term grade is estimated from the student's available current-term academic evidence.</p>
            <p>The intervention level is assigned separately using the school's grade-based intervention rules.</p>
          </div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
