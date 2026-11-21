import { useMemo } from "react";
import { Search, Sparkles } from "lucide-react";
import { Avatar } from "@/components/retroui/Avatar";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { OverviewCard } from "@/components/overview-cards";
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
  studentLrn?: string | null;
  sectionName?: string;
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
  onClassChange: (classId: number | undefined) => void;
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
    studentLrn: predictions.find((p) => Boolean(p.student_lrn))?.student_lrn || null,
    sectionName: predictions[0]?.class_name || undefined,
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
  grade: _grade,
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
    () => (selectedClassId !== undefined ? rows.filter((row) => row.class_id === selectedClassId) : rows),
    [rows, selectedClassId],
  );
  const subjects = useMemo(() => {
    const byId = new Map<number, AssignedSubjectSectionScope>();
    assignedScopes
      .filter((scope) => selectedClassId === undefined || scope.class_id === selectedClassId)
      .forEach((scope) => byId.set(scope.subject_id, scope));
    sectionRows.forEach((row) => {
      const existing = byId.get(row.subject_id);
      if (!existing) {
        byId.set(row.subject_id, {
          subject_id: row.subject_id,
          subject_name: row.subject_name,
          subject_codename: row.subject_codename,
          class_id: row.class_id,
          section_name: row.class_name,
        });
      } else if (!existing.subject_codename && row.subject_codename) {
        existing.subject_codename = row.subject_codename;
      }
    });
    return [...byId.values()].sort((a, b) => a.subject_name.localeCompare(b.subject_name));
  }, [assignedScopes, sectionRows, selectedClassId]);
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
      || (student.studentLrn && student.studentLrn.toLowerCase().includes(normalizedSearch))
      || student.studentId.toLowerCase().includes(normalizedSearch))
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
      || a.studentName.localeCompare(b.studentName)), [effectiveRisk, normalizedSearch, students]);
  const selectedSection = sections.find((section) => section.class_id === selectedClassId);
  const selectedSubject = subjects.find((subject) => subject.subject_id === effectiveSubjectId);
  const hasResultFilters = Boolean(
    search.trim()
    || effectiveRisk !== "ALL"
    || effectiveSubjectId !== undefined
    || selectedClassId !== undefined,
  );

  const clearFilters = () => {
    onClassChange(undefined);
    onSubjectChange(undefined);
    onRiskChange(undefined);
    onSearchChange("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-full flex-col gap-5">
        <div
          className={cn(
            "grid grid-cols-1 gap-3",
            sections.length === 1
              ? "grid-cols-1"
              : sections.length === 2
                ? "sm:grid-cols-2"
                : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
          )}
          aria-label="Section overviews"
        >
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
            const total = sectionStudents.length;
            return (
              <OverviewCard
                key={section.class_id}
                title={section.section_name}
                count={String(total)}
                stat={!sectionPredictionRows.length ? "Not generated" : counts.HIGH_RISK > 0 ? `${counts.HIGH_RISK} high risk` : "No high risk"}
                statDescription={total === 1 ? "student enrolled" : "students enrolled"}
                trend={counts.HIGH_RISK > 0 ? "down" : "up"}
                progressValue={total > 0 ? (counts.ON_TRACK / total) * 100 : undefined}
              />
            );
          })}
        </div>
      </div>

      <div className="flex w-full flex-col gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black">Student Predictions</h2>
            <Badge size="sm" variant="outline" className="border-2 border-black bg-yellow-50 font-bold">
              {selectedClassId === undefined ? "All Classes" : selectedSection?.section_name ?? "Selected Class"}
            </Badge>
            {selectedSubject && (
              <Badge size="sm" variant="outline" className="border-2 border-black bg-yellow-50 font-bold">
                {selectedSubject.subject_name}
              </Badge>
            )}
          </div>
          <p className="shrink-0 text-sm font-semibold text-muted-foreground">
            Showing {visibleStudents.length} of {students.length} students
          </p>
        </div>

        <div className="flex flex-col gap-3 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
              value={effectiveSubjectId !== undefined ? String(effectiveSubjectId) : "ALL"}
              onValueChange={(value) => onSubjectChange(value === "ALL" ? undefined : Number(value))}
            >
              <Select.Trigger aria-label="Subject filter" className="min-h-11 w-full sm:w-56">
                <Select.Value>
                  {selectedSubject?.subject_name ?? "All Subjects"}
                </Select.Value>
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="ALL">All Subjects</Select.Item>
                {subjects.map((subject) => (
                  <Select.Item key={subject.subject_id} value={String(subject.subject_id)}>
                    {subject.subject_name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
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
            {hasResultFilters && visibleStudents.length > 0 && (
              <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1" role="group" aria-label="Class filter">
            <span className="text-sm font-semibold text-muted-foreground mr-1">Class:</span>
            <Button
              type="button"
              size="sm"
              variant={selectedClassId === undefined ? "default" : "outline"}
              autoIcon={false}
              className={cn(
                "h-8 rounded border-2 border-black px-3 text-xs font-bold shadow-none hover:shadow-none hover:translate-y-0 active:translate-y-0",
                selectedClassId === undefined
                  ? "bg-primary text-black hover:bg-primary"
                  : "bg-background text-black hover:bg-muted",
              )}
              onClick={() => onClassChange(undefined)}
            >
              All
            </Button>
            {sections.map((section) => {
              const isSelected = selectedClassId === section.class_id;
              return (
                <Button
                  key={section.class_id}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  autoIcon={false}
                  className={cn(
                    "h-8 rounded border-2 border-black px-3 text-xs font-bold shadow-none hover:shadow-none hover:translate-y-0 active:translate-y-0",
                    isSelected
                      ? "bg-primary text-black hover:bg-primary"
                      : "bg-background text-black hover:bg-muted",
                  )}
                  onClick={() => onClassChange(isSelected ? undefined : section.class_id)}
                >
                  {section.section_name}
                </Button>
              );
            })}
          </div>
        </div>

        {selectedClassId !== undefined && !selectedSection ? (
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
          <Table wrapperClassName="shadow-none" containerClassName="overflow-x-auto">
            <Table.Header className="">
              <Table.Row className="">
                <Table.Head className="min-w-64 text-sm text-black">Student</Table.Head>
                {subjects.map((subject) => {
                  const subjectCode = subject.subject_codename || subject.subject_name;
                  return (
                    <Table.Head
                      key={subject.subject_id}
                      className={cn(
                        "min-w-28 text-center text-sm text-black transition-opacity",
                        effectiveSubjectId !== undefined && effectiveSubjectId !== subject.subject_id && "opacity-35",
                      )}
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              tabIndex={0}
                              className="inline-block cursor-help font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                            >
                              {subjectCode}
                            </span>
                          }
                        />
                        <TooltipContent>{subject.subject_name}</TooltipContent>
                      </Tooltip>
                    </Table.Head>
                  );
                })}
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
                          <p className="truncate text-xs text-muted-foreground">
                            {selectedClassId === undefined && student.sectionName ? `${student.sectionName} • ` : ""}
                            LRN {student.studentLrn || "—"}
                          </p>
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
                            "inline-flex min-h-7 min-w-14 items-center justify-center rounded border-2 border-black px-3 font-black",
                            gradeChipClass(prediction),
                          )}>
                            {grade === null ? "" : grade.toFixed(1)}
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
      </div>
    </div>
  );
}
