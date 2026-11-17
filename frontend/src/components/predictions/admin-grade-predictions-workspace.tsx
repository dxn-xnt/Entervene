import { useMemo } from "react";
import { ArrowRight, Check, Filter, Search, Sparkles } from "lucide-react";
import { Avatar } from "@/components/retroui/Avatar";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import { getRiskBadgeMeta } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  adminStudentRiskLevel,
  type AssignedSubjectSectionScope,
  type AuthorizedCurrentTermRow,
} from "./current-term-dashboard-adapter";

type DisplayRisk = "HIGH_RISK" | "MODERATE_RISK" | "ON_TRACK" | "INSUFFICIENT_DATA";
type RiskFilter = "ALL" | DisplayRisk;

interface SectionOption {
  class_id: number;
  section_name: string;
}

interface StudentPredictionSummary {
  studentId: string;
  studentName: string;
  predictions: AuthorizedCurrentTermRow[];
  risk: DisplayRisk;
}

interface AdminGradePredictionsWorkspaceProps {
  grade: number;
  rows: AuthorizedCurrentTermRow[];
  assignedScopes: AssignedSubjectSectionScope[];
  sections: SectionOption[];
  selectedClassId?: number;
  selectedSubjectId?: number;
  riskLevel?: string;
  search: string;
  onClassChange: (classId: number) => void;
  onSubjectChange: (subjectId: number | undefined) => void;
  onRiskChange: (risk: string | undefined) => void;
  onSearchChange: (search: string) => void;
  onPredictionSelect: (prediction: AuthorizedCurrentTermRow) => void;
}

const RISK_ORDER: Record<DisplayRisk, number> = {
  HIGH_RISK: 0,
  MODERATE_RISK: 1,
  ON_TRACK: 2,
  INSUFFICIENT_DATA: 3,
};

const RISK_META: Record<DisplayRisk, { label: string; dot: string; pill: string }> = {
  HIGH_RISK: {
    label: "High Risk",
    dot: "bg-[#ff3333]",
    pill: getRiskBadgeMeta("HIGH_RISK").bg,
  },
  MODERATE_RISK: {
    label: "Moderate Risk",
    dot: "bg-[#ff9233]",
    pill: getRiskBadgeMeta("MODERATE_RISK").bg,
  },
  ON_TRACK: {
    label: "On Track",
    dot: "bg-[#00e65f]",
    pill: getRiskBadgeMeta("ON_TRACK").bg,
  },
  INSUFFICIENT_DATA: {
    label: "Insufficient Data",
    dot: "bg-stone-500",
    pill: "bg-stone-200 text-stone-950",
  },
};

function studentRisk(predictions: AuthorizedCurrentTermRow[]): DisplayRisk {
  if (!predictions.some((row) => row.projected_final_term_grade !== null)) return "INSUFFICIENT_DATA";
  return adminStudentRiskLevel(predictions) ?? "INSUFFICIENT_DATA";
}

function summarizeStudents(rows: AuthorizedCurrentTermRow[]): StudentPredictionSummary[] {
  const byStudent = new Map<string, AuthorizedCurrentTermRow[]>();
  rows.forEach((row) => {
    const current = byStudent.get(row.student_id) ?? [];
    current.push(row);
    byStudent.set(row.student_id, current);
  });
  return [...byStudent.entries()].map(([studentId, predictions]) => ({
    studentId,
    studentName: predictions[0]?.student_name || studentId,
    predictions,
    risk: studentRisk(predictions),
  }));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "ST";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

function gradeChipClass(prediction: AuthorizedCurrentTermRow | undefined): string {
  if (!prediction || prediction.projected_final_term_grade === null) return "bg-stone-200 text-stone-800";
  if (prediction.intervention_level === "HIGH_RISK") return getRiskBadgeMeta("HIGH_RISK").bg;
  if (prediction.intervention_level === "MODERATE_RISK") return getRiskBadgeMeta("MODERATE_RISK").bg;
  return getRiskBadgeMeta("ON_TRACK").bg;
}

function representativePrediction(student: StudentPredictionSummary): AuthorizedCurrentTermRow {
  return [...student.predictions].sort(
    (a, b) => RISK_ORDER[studentRisk([a])] - RISK_ORDER[studentRisk([b])],
  )[0];
}

export function AdminGradePredictionsWorkspace({
  grade,
  rows,
  assignedScopes,
  sections,
  selectedClassId,
  selectedSubjectId,
  riskLevel,
  search,
  onClassChange,
  onSubjectChange,
  onRiskChange,
  onSearchChange,
  onPredictionSelect,
}: AdminGradePredictionsWorkspaceProps) {
  const sectionRows = useMemo(
    () => rows.filter((row) => row.class_id === selectedClassId),
    [rows, selectedClassId],
  );
  const subjects = useMemo(() => {
    const byId = new Map<number, AssignedSubjectSectionScope>();
    assignedScopes
      .filter((scope) => scope.class_id === selectedClassId)
      .forEach((scope) => byId.set(scope.subject_id, scope));
    return [...byId.values()].sort((a, b) => a.subject_name.localeCompare(b.subject_name));
  }, [assignedScopes, selectedClassId]);
  const effectiveSubjectId = subjects.some((subject) => subject.subject_id === selectedSubjectId)
    ? selectedSubjectId
    : undefined;
  const scopeRows = useMemo(
    () => sectionRows.filter((row) => effectiveSubjectId === undefined || row.subject_id === effectiveSubjectId),
    [effectiveSubjectId, sectionRows],
  );
  const students = useMemo(() => summarizeStudents(scopeRows), [scopeRows]);
  const effectiveRisk: RiskFilter = riskLevel === "HIGH_RISK"
    || riskLevel === "MODERATE_RISK"
    || riskLevel === "ON_TRACK"
    || riskLevel === "INSUFFICIENT_DATA"
    ? riskLevel
    : "ALL";
  const riskCounts = useMemo(() => {
    const counts: Record<RiskFilter, number> = {
      ALL: students.length,
      HIGH_RISK: 0,
      MODERATE_RISK: 0,
      ON_TRACK: 0,
      INSUFFICIENT_DATA: 0,
    };
    students.forEach((student) => { counts[student.risk] += 1; });
    return counts;
  }, [students]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleStudents = useMemo(() => students
    .filter((student) => effectiveRisk === "ALL" || student.risk === effectiveRisk)
    .filter((student) => !normalizedSearch
      || student.studentName.toLowerCase().includes(normalizedSearch)
      || student.studentId.toLowerCase().includes(normalizedSearch))
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
      || a.studentName.localeCompare(b.studentName)), [effectiveRisk, normalizedSearch, students]);
  const selectedSection = sections.find((section) => section.class_id === selectedClassId);
  const selectedSubject = subjects.find((subject) => subject.subject_id === effectiveSubjectId);
  const hasResultFilters = Boolean(search.trim() || effectiveRisk !== "ALL" || effectiveSubjectId !== undefined);

  const clearFilters = () => {
    onSubjectChange(undefined);
    onRiskChange(undefined);
    onSearchChange("");
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex w-full flex-col gap-5 bg-background p-4 shadow-none hover:shadow-none sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Section</h2>
          <p className="text-sm text-muted-foreground">
            {sections.length} {sections.length === 1 ? "section" : "sections"} in Grade {grade}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" role="group" aria-label="Section filters">
          {sections.map((section) => {
            const sectionPredictionRows = rows.filter((row) => row.class_id === section.class_id);
            const sectionStudents = summarizeStudents(sectionPredictionRows);
            const counts = {
              HIGH_RISK: 0,
              MODERATE_RISK: 0,
              ON_TRACK: 0,
              INSUFFICIENT_DATA: 0,
            };
            sectionStudents.forEach((student) => { counts[student.risk] += 1; });
            const selected = section.class_id === selectedClassId;
            const total = sectionStudents.length;
            return (
              <button
                key={section.class_id}
                type="button"
                aria-label={`Select section ${section.section_name}`}
                aria-pressed={selected}
                onClick={() => onClassChange(section.class_id)}
                className={cn(
                  "min-h-44 rounded border-2 border-black p-4 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "translate-x-[-2px] translate-y-[-2px] bg-primary shadow-[7px_7px_0_#000]"
                    : "bg-background shadow-[4px_4px_0_#000] hover:-translate-y-0.5",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-black">{section.section_name}</p>
                    <p className="mt-2 text-sm font-semibold">
                      {total} {total === 1 ? "student" : "students"}
                    </p>
                  </div>
                  {selected && <Check aria-hidden className="size-6 shrink-0 stroke-[3]" />}
                </div>
                <div className="mt-3 flex justify-end">
                  <Badge
                    size="sm"
                    className={cn(
                      "border-2 border-black",
                      !sectionPredictionRows.length
                        ? "bg-stone-200"
                        : counts.HIGH_RISK > 0
                          ? getRiskBadgeMeta("HIGH_RISK").bg
                          : getRiskBadgeMeta("ON_TRACK").bg,
                    )}
                  >
                    {!sectionPredictionRows.length
                      ? "Not generated"
                      : counts.HIGH_RISK > 0
                        ? `${counts.HIGH_RISK} high risk`
                        : "No high risk"}
                  </Badge>
                </div>
                {total > 0 ? (
                  <div
                    className="mt-3 flex h-3 overflow-hidden rounded-full border-2 border-black bg-stone-100"
                    aria-label={`${section.section_name} risk distribution`}
                  >
                    {(Object.keys(counts) as DisplayRisk[]).map((risk) => counts[risk] > 0 && (
                      <span
                        key={risk}
                        className={RISK_META[risk].dot}
                        style={{ width: `${(counts[risk] / total) * 100}%` }}
                        title={`${RISK_META[risk].label}: ${counts[risk]}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 h-3 rounded-full border-2 border-dashed border-black" aria-label="No risk distribution available" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold">Subjects</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Subject filters">
            <Button
              type="button"
              variant={effectiveSubjectId === undefined ? "default" : "outline"}
              aria-label="All Subjects"
              aria-pressed={effectiveSubjectId === undefined}
              autoIcon={false}
              className="min-h-11 gap-2"
              onClick={() => onSubjectChange(undefined)}
            >
              {effectiveSubjectId === undefined ? <Filter aria-hidden className="size-4" /> : <ArrowRight aria-hidden className="size-4" />}
              All Subjects
            </Button>
            {subjects.map((subject) => {
              const selected = effectiveSubjectId === subject.subject_id;
              return (
                <Button
                  key={subject.subject_id}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  aria-label={subject.subject_name}
                  aria-pressed={selected}
                  autoIcon={false}
                  className="min-h-11 gap-2"
                  onClick={() => onSubjectChange(subject.subject_id)}
                >
                  {selected ? <Filter aria-hidden className="size-4" /> : <ArrowRight aria-hidden className="size-4" />}
                  {subject.subject_name}
                </Button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="flex w-full flex-col gap-0 overflow-hidden bg-background p-0 shadow-none hover:shadow-none">
        <div className="flex flex-wrap items-center gap-3 border-b-2 border-black p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black">Student Predictions</h2>
            <Badge size="sm" variant="outline" className="border-2 border-black bg-yellow-50">
              {selectedSubject?.subject_name ?? "All Subjects"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-black/15 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              variant="search"
              aria-label="Search student or LRN"
              placeholder="Search student or LRN..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="min-h-11 w-full"
            />
          </div>
          <Select
            value={effectiveRisk}
            onValueChange={(value) => onRiskChange(value === "ALL" ? undefined : value)}
          >
            <Select.Trigger aria-label="Risk level" className="min-h-11 w-full sm:w-56">
              <Select.Value>
                {effectiveRisk === "ALL" ? "All Risk Levels" : RISK_META[effectiveRisk].label}
              </Select.Value>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="ALL">All Risk Levels ({riskCounts.ALL})</Select.Item>
              <Select.Item value="HIGH_RISK">High Risk ({riskCounts.HIGH_RISK})</Select.Item>
              <Select.Item value="MODERATE_RISK">Moderate Risk ({riskCounts.MODERATE_RISK})</Select.Item>
              <Select.Item value="ON_TRACK">On Track ({riskCounts.ON_TRACK})</Select.Item>
              <Select.Item value="INSUFFICIENT_DATA">Insufficient Data ({riskCounts.INSUFFICIENT_DATA})</Select.Item>
            </Select.Content>
          </Select>
          <p className="shrink-0 text-sm text-muted-foreground">
            Showing {visibleStudents.length} of {students.length} students
          </p>
          {hasResultFilters && visibleStudents.length > 0 && (
            <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {!selectedSection ? (
          <div className="p-4">
            <EmptyStateCard compact icon={<Sparkles />} title="Select a section" description="Choose a section to view student predictions." />
          </div>
        ) : scopeRows.length === 0 ? (
          <div className="p-4">
            <EmptyStateCard
              compact
              icon={<Sparkles />}
              title="No predictions generated"
              description="Predictions will appear automatically after valid academic evidence is available for this scope."
            />
          </div>
        ) : visibleStudents.length === 0 ? (
          <div className="p-4">
            <EmptyStateCard
              compact
              icon={<Search />}
              title="No predictions match these filters"
              description="Try another student, subject, or risk level."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          </div>
        ) : (
          <Table wrapperClassName="rounded-none border-0 shadow-none" containerClassName="overflow-x-auto">
            <Table.Header className="border-b border-black/20 bg-yellow-50 text-black">
              <Table.Row className="bg-yellow-50 hover:bg-yellow-50">
                <Table.Head className="min-w-64 text-sm text-black">Student</Table.Head>
                {subjects.map((subject) => (
                  <Table.Head
                    key={subject.subject_id}
                    className={cn(
                      "min-w-40 text-center text-sm text-black transition-opacity",
                      effectiveSubjectId !== undefined && effectiveSubjectId !== subject.subject_id && "opacity-35",
                    )}
                  >
                    {subject.subject_name}
                  </Table.Head>
                ))}
                <Table.Head className="min-w-48 text-center text-sm text-black">Risk Level</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visibleStudents.map((student) => {
                const allStudentPredictions = sectionRows.filter((row) => row.student_id === student.studentId);
                const predictionsBySubject = new Map(allStudentPredictions.map((row) => [row.subject_id, row]));
                const riskMeta = RISK_META[student.risk];
                const detailPrediction = representativePrediction(student);
                return (
                  <Table.Row
                    key={student.studentId}
                    className="cursor-pointer border-b border-black/15 hover:bg-yellow-50"
                    onClick={() => onPredictionSelect(detailPrediction)}
                  >
                    <Table.Cell>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-11 shrink-0 border-2 border-black">
                          <Avatar.Fallback className="bg-yellow-100 text-sm font-black">
                            {initials(student.studentName)}
                          </Avatar.Fallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-bold">{student.studentName}</p>
                          <p className="truncate text-xs text-muted-foreground">LRN {student.studentId}</p>
                        </div>
                      </div>
                    </Table.Cell>
                    {subjects.map((subject) => {
                      const prediction = predictionsBySubject.get(subject.subject_id);
                      const grade = prediction?.projected_final_term_grade ?? null;
                      return (
                        <Table.Cell
                          key={subject.subject_id}
                          className={cn(
                            "text-center transition-opacity",
                            effectiveSubjectId !== undefined && effectiveSubjectId !== subject.subject_id && "opacity-35",
                          )}
                        >
                          <span className={cn(
                            "inline-flex min-h-11 min-w-14 items-center justify-center rounded border-2 border-black px-3 font-black",
                            gradeChipClass(prediction),
                          )}>
                            {grade === null ? "—" : grade.toFixed(1)}
                          </span>
                        </Table.Cell>
                      );
                    })}
                    <Table.Cell className="text-center">
                      <Badge size="md" className={cn("gap-2 border-2 border-black", riskMeta.pill)}>
                        <span aria-hidden className={cn("size-3 rounded-full", riskMeta.dot)} />
                        {riskMeta.label}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </Card>
    </div>
  );
}
