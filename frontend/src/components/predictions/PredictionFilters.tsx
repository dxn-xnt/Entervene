import type { DashboardFilters } from "@/lib/prediction-api";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/retroui/Button";
import { Search, X } from "lucide-react";

interface PredictionFiltersProps {
  filters: DashboardFilters | null;
  classId?: number;
  subjectId?: number;
  term?: number;
  riskLevel?: string;
  search: string;
  onClassChange: (value: number | undefined) => void;
  onSubjectChange: (value: number | undefined) => void;
  onTermChange: (value: number | undefined) => void;
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
  classId,
  subjectId,
  term,
  riskLevel,
  search,
  onClassChange,
  onSubjectChange,
  onTermChange,
  onRiskChange,
  onSearchChange,
  onClearAll,
}: PredictionFiltersProps) {
  const hasActiveFilters =
    classId !== undefined ||
    subjectId !== undefined ||
    term !== undefined ||
    riskLevel !== undefined ||
    search.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 z-10"
          />
          <Input
            placeholder="Search student or LRN..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-10 w-full bg-white text-sm border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:ring-0"
          />
        </div>

        {/* Class */}
        <Select
          value={classId !== undefined ? String(classId) : "all"}
          onValueChange={(v) =>
            onClassChange(v === "all" ? undefined : Number(v))
          }
        >
          <Select.Trigger className="w-[160px] h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
            <Select.Value placeholder="All Classes" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Select.Item value="all">All Classes</Select.Item>
            {filters?.classes.map((c) => (
              <Select.Item key={c.class_id} value={String(c.class_id)}>
                {c.section_name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        {/* Subject */}
        <Select
          value={subjectId !== undefined ? String(subjectId) : "all"}
          onValueChange={(v) =>
            onSubjectChange(v === "all" ? undefined : Number(v))
          }
        >
          <Select.Trigger className="w-[200px] h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
            <Select.Value placeholder="All Subjects" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Select.Item value="all">All Subjects</Select.Item>
            {filters?.subjects.map((s) => (
              <Select.Item key={s.subject_id} value={String(s.subject_id)}>
                {s.subject_name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        {/* Term */}
        <Select
          value={term !== undefined ? String(term) : "all"}
          onValueChange={(v) =>
            onTermChange(v === "all" ? undefined : Number(v))
          }
        >
          <Select.Trigger className="w-[140px] h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
            <Select.Value placeholder="All Terms" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Select.Item value="all">All Terms</Select.Item>
            {filters?.terms.map((t) => (
              <Select.Item key={t.term_number} value={String(t.term_number)}>
                {t.term_label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        {/* Risk Level */}
        <Select
          value={riskLevel ?? "all"}
          onValueChange={(v) =>
            onRiskChange(v === "all" ? undefined : v)
          }
        >
          <Select.Trigger className="w-[180px] h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
            <Select.Value placeholder="All Risk Levels" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Select.Item value="all">All Risk Levels</Select.Item>
            {RISK_OPTIONS.map((r) => (
              <Select.Item key={r.value} value={r.value}>
                {r.label}
              </Select.Item>
            ))}
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

