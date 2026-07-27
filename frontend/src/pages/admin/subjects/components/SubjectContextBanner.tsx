import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Card as RetroCard } from "@/components/retroui/Card";
import { formatPeriodLabel } from "@/lib/academic-periods";
import type {
  SubjectOfferingAcademicPeriod,
  SubjectOfferingAcademicYear,
} from "@/lib/api";

type SubjectContextBannerProps = {
  academicYears?: Array<SubjectOfferingAcademicYear & { start_date?: string; end_date?: string }>;
  academicPeriods?: SubjectOfferingAcademicPeriod[];
  academicYearId?: number | null;
  academicPeriodId?: number | null;
  yearLabel?: string | null;
  periodLabel?: string | null;
  isLoading?: boolean;
};

function findActiveYear(
  academicYears: SubjectContextBannerProps["academicYears"] = [],
  academicYearId?: number | null
) {
  if (academicYearId) {
    return academicYears.find((year) => year.academic_year_id === academicYearId) ?? null;
  }
  return academicYears.find((year) => year.is_active) ?? null;
}

function findPeriod(
  academicPeriods: SubjectOfferingAcademicPeriod[] = [],
  academicPeriodId?: number | null
) {
  if (!academicPeriodId) return null;
  return academicPeriods.find((period) => period.academic_period_id === academicPeriodId) ?? null;
}

export function SubjectContextBanner({
  academicYears = [],
  academicPeriods = [],
  academicYearId,
  academicPeriodId,
  yearLabel,
  periodLabel,
  isLoading = false,
}: SubjectContextBannerProps) {
  const activeYear = findActiveYear(academicYears, academicYearId);
  const selectedPeriod = findPeriod(academicPeriods, academicPeriodId);
  const displayYear = yearLabel ?? activeYear?.year_label ?? null;
  const displayPeriod = periodLabel ?? (selectedPeriod ? formatPeriodLabel(selectedPeriod) : null);
  const hasCompleteContext = Boolean(displayYear && displayPeriod);

  return (
    <RetroCard className="w-full overflow-hidden p-0">
      <div className="flex flex-col gap-3 bg-[#fff1b8] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md border-2 border-black bg-background shadow-[2px_2px_0_#000]">
            <CalendarDays className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-black/70">Current setup context</p>
            <p className="text-lg font-bold">
              {isLoading
                ? "Loading academic context..."
                : hasCompleteContext
                  ? `${displayYear} • ${displayPeriod}`
                  : "Current setup context unavailable"}
            </p>
            <p className="text-xs text-black/70">Change academic year or active term in System Settings.</p>
          </div>
        </div>
        <Badge size="sm" variant={hasCompleteContext ? "surface" : "outline"}>
          {hasCompleteContext ? "Active context" : "Needs setup"}
        </Badge>
      </div>
    </RetroCard>
  );
}
