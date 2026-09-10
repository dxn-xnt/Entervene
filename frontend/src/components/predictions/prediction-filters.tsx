import { useEffect } from "react";
import type { DashboardFilters, RiskSummary } from "@/lib/prediction-api";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/retroui/Button";
import { Search, X } from "lucide-react";

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
  riskSummary?: RiskSummary | null;
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
  riskSummary,
  onGradeChange,
  onClassChange,
  onSubjectChange,
  onTermChange,
  onPeriodChange,
  onRiskChange,
  onSearchChange,
  onClearAll,
}: PredictionFiltersProps) {
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
    activePeriod !== undefined ||
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
            placeholder="Search student or LRN..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-10 w-full bg-white"
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
            <Select.Trigger className="w-[140px] bg-white">
              <Select.Value placeholder="All Grades" />
            </Select.Trigger>
            <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
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
            <Select.Trigger className="w-[160px] bg-white">
              <Select.Value placeholder="All Classes" />
            </Select.Trigger>
            <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
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
            <Select.Trigger className="w-[160px] bg-white">
              <Select.Value placeholder="All Subjects" />
            </Select.Trigger>
            <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
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
        <Select
          value={activePeriod !== undefined ? String(activePeriod) : "all"}
          onValueChange={(v) => {
            const val = v === "all" ? undefined : Number(v);
            onPeriodChange?.(val);
            onTermChange?.(val);
          }}
        >
          <Select.Trigger className="w-[140px] bg-white">
            <Select.Value placeholder="All Terms" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Select.Item value="all">All Terms</Select.Item>
            {filters?.terms.map((t) => (
              <Select.Item key={t.academic_period_id} value={String(t.academic_period_id)}>
                {t.term_label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        {/* Risk Level Filter */}
        <Select
          value={riskLevel ?? "all"}
          onValueChange={(v) =>
            onRiskChange(v === "all" ? undefined : v)
          }
        >
          <Select.Trigger className="w-[170px] bg-white">
            <Select.Value placeholder="All Risk Levels">
              {riskLevel ? (RISK_OPTIONS.find((r) => r.value === riskLevel)?.label ?? riskLevel) : "All Risk Levels"}
            </Select.Value>
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Select.Item value="all">
              All Risk Levels{riskSummary ? ` (${riskSummary.total})` : ""}
            </Select.Item>
            {RISK_OPTIONS.map((r) => {
              const count = riskSummary ? riskSummary[r.value as keyof RiskSummary] : undefined;
              return (
                <Select.Item key={r.value} value={r.value}>
                  {r.label}{count !== undefined ? ` (${count})` : ""}
                </Select.Item>
              );
            })}
          </Select.Content>
        </Select>

        {hasActiveFilters && (
          <Button
            size="sm"
            onClick={onClearAll}
            className="h-10 border-2 border-black bg-yellow-300 hover:bg-yellow-400 text-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            <X size={14} className="mr-1 stroke-[3]" />
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
}
