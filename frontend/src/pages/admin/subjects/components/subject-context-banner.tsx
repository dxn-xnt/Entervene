import { CalendarDays } from "lucide-react";
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
    <div className="flex flex-col gap-2 text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="shrink-0" aria-hidden="true">
            <CalendarDays className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm">Current setup context</p>
            <p className="text-sm">
              {isLoading
                ? "Loading academic context..."
                : hasCompleteContext
                  ? `${displayYear} • ${displayPeriod}`
                  : "Current setup context unavailable"}
            </p>
            <p className="text-xs">Change academic year or active term in System Settings.</p>
          </div>
        </div>
        <span className="text-xs">{hasCompleteContext ? "Active context" : "Needs setup"}</span>
    </div>
  );
}
