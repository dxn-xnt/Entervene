import { Calendar, Filter, RefreshCw, RotateCcw, Users } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/teacher/button";
import { Select } from "@/components/retroui/Select";
import type { TeacherDashboardPhaseTwo } from "@/lib/api";

export interface DashboardScopeOption {
  id: number;
  label: string;
}

interface DashboardScopeBarProps {
  periodName?: string | null;
  academicYearLabel?: string | null;
  isHistorical: boolean;
  activeClassesCount: number;
  enrolledStudentsCount: number;
  termProgress?: TeacherDashboardPhaseTwo["term_progress"];
  classOptions: DashboardScopeOption[];
  subjectOptions: DashboardScopeOption[];
  selectedClassId: string;
  selectedSubjectId: string;
  onClassChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onResetFilters: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function DashboardScopeBar({
  periodName,
  academicYearLabel,
  isHistorical,
  activeClassesCount,
  enrolledStudentsCount,
  termProgress,
  classOptions,
  subjectOptions,
  selectedClassId,
  selectedSubjectId,
  onClassChange,
  onSubjectChange,
  onResetFilters,
  onRefresh,
  isRefreshing,
}: DashboardScopeBarProps) {
  const hasFilters = selectedClassId !== "all" || selectedSubjectId !== "all";

  const termProgressLabel = (() => {
    if (!termProgress || termProgress.warnings.length > 0 || termProgress.total_weeks <= 0) {
      return null;
    }
    if (termProgress.elapsed_days <= 0) return "Not started";
    if (termProgress.elapsed_days >= termProgress.total_days) {
      return `Completed (${termProgress.total_weeks} wks)`;
    }
    return `Week ${termProgress.week_number} of ${termProgress.total_weeks}`;
  })();

  return (
    <div className="flex flex-col gap-3 border-b-2 border-black bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <SidebarTrigger className="shrink-0 md:hidden" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-3xl">
                Teacher Analytics Dashboard
              </h1>
              {isHistorical ? (
                <Badge variant="outline" size="sm" className="font-semibold">
                  Historical · Read-Only
                </Badge>
              ) : (
                <Badge variant="surface" size="sm" className="font-semibold">
                  Active Period
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-sm">
              {(academicYearLabel || periodName) && (
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Calendar className="size-3.5" />
                  {[academicYearLabel, periodName].filter(Boolean).join(" · ")}
                </span>
              )}
              {termProgressLabel && (
                <span className="inline-flex items-center gap-1 rounded border border-black/30 bg-muted/40 px-1.5 py-0.5 text-xs font-medium text-foreground">
                  {termProgressLabel}
                  {termProgress?.progress_percent != null
                    ? ` (${termProgress.progress_percent.toFixed(0)}%)`
                    : ""}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" />
                {activeClassesCount} {activeClassesCount === 1 ? "class" : "classes"} ·{" "}
                {enrolledStudentsCount} {enrolledStudentsCount === 1 ? "student" : "students"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Filter className="size-3.5" />
            <span className="hidden sm:inline">Scope:</span>
          </div>

          <Select value={selectedClassId} onValueChange={onClassChange}>
            <Select.Trigger
              aria-label="Filter dashboard by class"
              className="h-9 min-w-[140px] border-2 border-black bg-background text-xs font-semibold sm:min-w-[160px] sm:text-sm"
            >
              <Select.Value placeholder="All Classes" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All Classes</Select.Item>
              {classOptions.map((option) => (
                <Select.Item key={option.id} value={String(option.id)}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>

          <Select value={selectedSubjectId} onValueChange={onSubjectChange}>
            <Select.Trigger
              aria-label="Filter dashboard by subject"
              className="h-9 min-w-[145px] border-2 border-black bg-background text-xs font-semibold sm:min-w-[175px] sm:text-sm"
            >
              <Select.Value placeholder="All Subjects" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All Subjects</Select.Item>
              {subjectOptions.map((option) => (
                <Select.Item key={option.id} value={String(option.id)}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>

          {hasFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onResetFilters}
              className="h-9 gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
