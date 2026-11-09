import { useEffect } from "react";
import type { DashboardFilters, RiskSummary } from "@/lib/prediction-api";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/teacher/button";
import { Search } from "lucide-react";
import {
  getTeacherRiskDisplay,
  getTeacherRiskFilterCount,
  TEACHER_RISK_FILTER_OPTIONS,
} from "./teacher-risk-display";

interface PredictionFiltersProps {
  filters: DashboardFilters | null;
  gradeLevel?: number;
  classId?: number;
  subjectId?: number;
  academicPeriodId?: number;
  term?: number;
  riskLevel?: string;
  search: string;
  hideClassFilter?: boolean;
  hideGradeFilter?: boolean;
  hideSubjectFilter?: boolean;
  hidePeriodFilter?: boolean;
  showClearButton?: boolean;
  riskSummary?: RiskSummary | null;
  simplifiedTeacherRisk?: boolean;
  onGradeChange?: (value: number | undefined) => void;
  onClassChange?: (value: number | undefined) => void;
  onSubjectChange: (value: number | undefined) => void;
  onTermChange?: (value: number | undefined) => void;
  onPeriodChange?: (value: number | undefined) => void;
  onRiskChange: (value: string | undefined) => void;
  onSearchChange: (value: string) => void;
  onClearAll: () => void;
}

const RISK_OPTIONS = [
  { value: "HIGH_RISK", label: "High Risk" },
  { value: "MODERATE_RISK", label: "Moderate Risk" },
  { value: "NEEDS_MONITORING", label: "Needs Monitoring" },
  { value: "LOW_RISK", label: "Low Risk" },
  { value: "INSUFFICIENT_DATA", label: "Insufficient Data" },
];

export default function PredictionFilters({
  filters,
  gradeLevel,
  classId,
  subjectId,
  academicPeriodId,
  term,
  riskLevel,
  search,
  hideClassFilter = false,
  hideGradeFilter = false,
  hideSubjectFilter = false,
  hidePeriodFilter = false,
  showClearButton = true,
  riskSummary,
  simplifiedTeacherRisk = false,
  onGradeChange,
  onClassChange,
  onSubjectChange,
  onTermChange,
  onPeriodChange,
  onRiskChange,
  onSearchChange,
  onClearAll,
}: PredictionFiltersProps) {
  const riskOptions = simplifiedTeacherRisk ? TEACHER_RISK_FILTER_OPTIONS : RISK_OPTIONS;
  // Cascaded classes: if gradeLevel is chosen, only show sections belonging to that grade level
  const filteredClasses =
    gradeLevel !== undefined && filters?.classes
      ? filters.classes.filter((c) => c.grade_level === gradeLevel)
      : filters?.classes ?? [];

  // Reset classId if it no longer exists in filteredClasses
  useEffect(() => {
    if (classId !== undefined && gradeLevel !== undefined) {
      const exists = filteredClasses.some((c) => c.class_id === classId);
      if (!exists) {
        onClassChange?.(undefined);
      }
    }
  }, [gradeLevel, classId, filteredClasses, onClassChange]);

  const activePeriod = academicPeriodId !== undefined ? academicPeriodId : term;

  const hasActiveFilters =
    (!hideGradeFilter && gradeLevel !== undefined) ||
    (!hideClassFilter && classId !== undefined) ||
    (!hideSubjectFilter && subjectId !== undefined) ||
    (!hidePeriodFilter && activePeriod !== undefined) ||
    riskLevel !== undefined ||
    search.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 w-full min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 z-10"
          />
          <Input
            variant="search"
            placeholder="Search student or LRN..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Grade Level Filter */}
        {!hideGradeFilter && filters?.grades && filters.grades.length > 0 && (
          <Select
            value={gradeLevel !== undefined ? String(gradeLevel) : "all"}
            onValueChange={(v) =>
              onGradeChange?.(v === "all" ? undefined : Number(v))
            }
          >
            <Select.Trigger className="w-full sm:w-48">
              <Select.Value placeholder="All Grades" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All Grades</Select.Item>
              {filters.grades.map((g) => (
                <Select.Item key={g.grade_level} value={String(g.grade_level)}>
                  {g.level_name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        )}

        {/* Class / Section Filter */}
        {!hideClassFilter && (
          <Select
            value={classId !== undefined ? String(classId) : "all"}
            onValueChange={(v) =>
              onClassChange?.(v === "all" ? undefined : Number(v))
            }
          >
            <Select.Trigger className="w-full sm:w-48">
              <Select.Value placeholder="All Classes" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All Classes</Select.Item>
              {filteredClasses.map((c) => (
                <Select.Item key={c.class_id} value={String(c.class_id)}>
                  {c.section_name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        )}

        {/* Subject Filter */}
        {!hideSubjectFilter && (
          <Select
            value={subjectId !== undefined ? String(subjectId) : "all"}
            onValueChange={(v) =>
              onSubjectChange(v === "all" ? undefined : Number(v))
            }
          >
            <Select.Trigger className="w-full sm:w-48">
              <Select.Value placeholder="All Subjects" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All Subjects</Select.Item>
              {filters?.subjects.map((s) => (
                <Select.Item key={s.subject_id} value={String(s.subject_id)}>
                  {s.subject_codename ? `${s.subject_name} (${s.subject_codename})` : s.subject_name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        )}

        {/* Term Filter (Binds directly to academic_period_id) */}
        {!hidePeriodFilter && <Select
          value={activePeriod !== undefined ? String(activePeriod) : "all"}
          onValueChange={(v) => {
            const val = v === "all" ? undefined : Number(v);
            onPeriodChange?.(val);
            onTermChange?.(val);
          }}
        >
          <Select.Trigger className="w-full sm:w-48">
            <Select.Value placeholder="All Terms" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All Terms</Select.Item>
            {filters?.terms.map((t) => (
              <Select.Item key={t.academic_period_id} value={String(t.academic_period_id)}>
                {t.term_label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>}

        {/* Risk Level Filter */}
        <Select
          value={riskLevel ?? "all"}
          onValueChange={(v) =>
            onRiskChange(v === "all" ? undefined : v)
          }
        >
          <Select.Trigger className="w-full sm:w-48">
            <Select.Value placeholder="All Risk Levels">
              {riskLevel
                ? (riskOptions.find((r) => r.value === riskLevel)?.label
                  ?? (simplifiedTeacherRisk ? getTeacherRiskDisplay(riskLevel).label : riskLevel))
                : "All Risk Levels"}
            </Select.Value>
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">
              All Risk Levels{riskSummary ? ` (${riskSummary.total})` : ""}
            </Select.Item>
            {riskOptions.map((r) => {
              const count = riskSummary
                ? (simplifiedTeacherRisk
                  ? getTeacherRiskFilterCount(riskSummary, r.value)
                  : riskSummary[r.value as keyof RiskSummary])
                : undefined;
              return (
                <Select.Item key={r.value} value={r.value}>
                  {r.label}{count !== undefined ? ` (${count})` : ""}
                </Select.Item>
              );
            })}
          </Select.Content>
        </Select>

        {showClearButton && hasActiveFilters && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onClearAll}
            className="border-2 shadow-none"
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
